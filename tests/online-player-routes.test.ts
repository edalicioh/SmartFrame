import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import * as database from "@smartframe/database";
import { onlineDashboardSchema, readStoredOnlineDashboard } from "@smartframe/contracts";
import { issuePairingCode, redeemPairingCode } from "@smartframe/frames";

vi.mock("server-only", () => ({}));
const panelAccess = vi.hoisted(() => vi.fn());
const onlineWidgetDataMock = vi.hoisted(() =>
  vi
    .fn<
      (...args: [unknown, unknown, string]) => Promise<{
        refreshSeconds: number;
        weather: null;
        currencies: Record<string, never>;
      }>
    >()
    .mockResolvedValue({
      refreshSeconds: 1800,
      weather: null,
      currencies: {},
    }),
);
vi.mock("../apps/web/src/lib/panel-access", () => ({ panelAccess }));
vi.mock("@smartframe/widgets", async (original) => ({
  ...(await original<typeof import("@smartframe/widgets")>()),
  onlineWidgetData: onlineWidgetDataMock,
}));

import { GET as getConfig } from "../apps/web/src/app/api/player/config/route";
import { POST as postPlayerTasks } from "../apps/web/src/app/api/player/tasks/route";
import { GET as getDashboard } from "../apps/web/src/app/player/[deviceId]/route";
import {
  GET as getOnlineFrame,
  PUT as putOnlineFrame,
} from "../apps/web/src/app/api/online-frame/route";
import { POST as publishOnlineFrame } from "../apps/web/src/app/api/online-frame/publish/route";
import { POST as previewWidgets } from "../apps/web/src/app/api/online-frame/widgets/route";
import { PUT as savePanel } from "../apps/web/src/app/api/panels/route";
import { publishOnlinePanel } from "../apps/web/src/lib/publish-online-panel";
import { previewWidgetSettings } from "../apps/web/src/lib/online-editor/widget-settings";

const db = database.getDatabase();
const userId = randomUUID();
let householdId: string;
let deviceId: string;
let token: string;
const adminRequest = (url: string, body?: unknown) =>
  new Request(`https://example.test${url}`, {
    method: body ? "PUT" : "GET",
    headers: {
      origin: "https://example.test",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

beforeAll(async () => {
  process.env.BETTER_AUTH_URL = "https://example.test";
  const user = await db.user.create({
    data: {
      id: userId,
      name: "Online",
      email: `${userId}@test.local`,
      household: { create: { name: "Casa" } },
    },
    include: { household: true },
  });
  householdId = user.household!.id;
  panelAccess.mockResolvedValue({ household: { id: householdId }, user: { id: userId } });
  const pairing = await issuePairingCode(db, householdId, userId);
  const paired = await redeemPairingCode(db, pairing.code, "Tablet");
  deviceId = paired.deviceId;
  token = paired.token;
});
afterAll(async () => {
  await db.household.deleteMany({ where: { ownerId: userId } });
  await db.user.deleteMany({ where: { id: userId } });
  await db.$disconnect();
});

it("serves canonical dashboard HTML by safe device path without caching or credentials", async () => {
  const response = await getDashboard(new Request(`https://example.test/player/${deviceId}`), {
    params: Promise.resolve({ deviceId }),
  });
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-frame-options")).toBe("SAMEORIGIN");
  const html = await response.text();
  expect(html).toContain("/player-dashboard/js/app.js");
  expect(html).toContain("/player-dashboard/css/layout.css");
  expect(html).not.toContain(token);
  const invalidId = "../secret";
  expect(
    (
      await getDashboard(new Request("https://example.test/player/../secret"), {
        params: Promise.resolve({ deviceId: invalidId }),
      })
    ).status,
  ).toBe(404);
});

it("uses only a device's published version and never acknowledges merely delivered config", async () => {
  const authRequest = (query = "") =>
    new Request(`https://example.test/api/player/config${query}`, {
      headers: { authorization: `Bearer ${token}` },
    });
  expect((await getConfig(authRequest("?deviceId=wrong"))).status).toBe(403);
  expect((await getConfig(authRequest())).status).toBe(409);
  const device = await db.device.findUniqueOrThrow({ where: { id: deviceId } });
  expect(device.appliedRevision).toBeNull();
  const put = await putOnlineFrame(
    adminRequest("/api/online-frame", {
      deviceId,
      config: {
        refreshSeconds: 20,
        widgets: {
          system: { enabled: false },
          rss: { enabled: false, feedUrl: "https://feeds.example.com/news.xml", maxItems: 8 },
          devMonitor: { enabled: false, showServerMetrics: false },
        },
        pages: [
          {
            id: "weather-page",
            title: "Weather",
            enabledWidgets: ["photos", "weather", "currencies", "system", "rss", "devMonitor"],
          },
        ],
      },
      expectedRevision: 0,
    }),
  );
  expect(put.status).toBe(200);
  expect(
    (
      await publishOnlineFrame(
        new Request("https://example.test/api/online-frame/publish", {
          method: "POST",
          headers: { origin: "https://example.test", "content-type": "application/json" },
          body: JSON.stringify({ deviceId, expectedRevision: 1 }),
        }),
      )
    ).status,
  ).toBe(200);
  const delivered = await getConfig(authRequest());
  expect(delivered.status).toBe(200);
  expect((await delivered.json()).refreshSeconds).toBe(20);
  const onlineSettings = onlineWidgetDataMock.mock.calls.at(-1)?.[1];
  expect(onlineSettings).toMatchObject({
    weather: { enabled: true },
    currencies: { enabled: true },
    system: { enabled: true },
    rss: { enabled: true, feedUrl: "https://feeds.example.com/news.xml", maxItems: 8 },
    devMonitor: { enabled: true, showServerMetrics: false },
  });
  expect(onlineWidgetDataMock.mock.calls.at(-1)?.[2]).toBe(householdId);
  expect(
    (await db.device.findUniqueOrThrow({ where: { id: deviceId } })).appliedRevision,
  ).toBeNull();
  const state = await (
    await getOnlineFrame(new Request(`https://example.test/api/online-frame?deviceId=${deviceId}`))
  ).json();
  expect(state.publishedRevision).toMatch(/^online:/);
  expect(state.config.refreshSeconds).toBe(20);
});

it("rejects stale draft writes and impossible media selections", async () => {
  const put = (config: unknown, expectedRevision: number) =>
    putOnlineFrame(adminRequest("/api/online-frame", { deviceId, config, expectedRevision }));
  expect((await put({ refreshSeconds: 30 }, 1)).status).toBe(200);
  expect((await put({ refreshSeconds: 40 }, 1)).status).toBe(409);
  expect(
    (
      await publishOnlineFrame(
        new Request("https://example.test/api/online-frame/publish", {
          method: "POST",
          headers: { origin: "https://example.test", "content-type": "application/json" },
          body: JSON.stringify({ deviceId, expectedRevision: 2 }),
        }),
      )
    ).status,
  ).toBe(200);
  expect(
    (await put({ widgets: { photos: { photoIds: [randomUUID()] } }, refreshSeconds: 40 }, 2))
      .status,
  ).toBe(200);
  const rejected = await publishOnlineFrame(
    new Request("https://example.test/api/online-frame/publish", {
      method: "POST",
      headers: { origin: "https://example.test", "content-type": "application/json" },
      body: JSON.stringify({ deviceId, expectedRevision: 3 }),
    }),
  );
  expect(rejected.status).toBe(400);
});

it("preview widgets require a panel session, same origin and validated pairs", async () => {
  const request = (config: unknown, origin = "https://example.test") =>
    new Request("https://example.test/api/online-frame/widgets", {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify(config),
    });
  expect((await previewWidgets(request({}, "https://other.test"))).status).toBe(403);
  panelAccess.mockResolvedValueOnce(null);
  expect((await previewWidgets(request({}))).status).toBe(401);
  expect(
    (await previewWidgets(request({ widgets: { currencies: { pairs: ["BAD/USD"] } } }))).status,
  ).toBe(400);
  const response = await previewWidgets(
    request({ widgets: { currencies: { pairs: ["BTC/USD"] } } }),
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toHaveProperty("currencies");
  expect(onlineWidgetDataMock.mock.calls.at(-1)?.[2]).toBe(householdId);
});

it("player can toggle interactive tasks and sync both active version and draft", async () => {
  const before = await (
    await getOnlineFrame(new Request(`https://example.test/api/online-frame?deviceId=${deviceId}`))
  ).json();
  expect(
    (
      await putOnlineFrame(
        adminRequest("/api/online-frame", {
          deviceId,
          expectedRevision: before.draftRevision,
          config: {
            ...before.config,
            widgets: {
              ...before.config.widgets,
              photos: { ...before.config.widgets.photos, photoIds: [] },
              tasks: {
                enabled: true,
                title: "Casa",
                interactive: true,
                showCompleted: true,
                items: [{ id: "task-1", text: "Regar plantas", completed: false }],
              },
            },
          },
        }),
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await publishOnlineFrame(
        new Request("https://example.test/api/online-frame/publish", {
          method: "POST",
          headers: { origin: "https://example.test", "content-type": "application/json" },
          body: JSON.stringify({ deviceId, expectedRevision: before.draftRevision + 1 }),
        }),
      )
    ).status,
  ).toBe(200);

  let publishedRevision = (
    await (
      await getOnlineFrame(
        new Request(`https://example.test/api/online-frame?deviceId=${deviceId}`),
      )
    ).json()
  ).publishedRevision;
  const toggleRequest = (body: object, auth = `Bearer ${token}`, query = "") =>
    new Request(`https://example.test/api/player/tasks${query}`, {
      method: "POST",
      headers: { authorization: auth, "content-type": "application/json" },
      body: JSON.stringify({ revision: publishedRevision, ...body }),
    });

  expect(
    (await postPlayerTasks(toggleRequest({ taskId: "task-1", completed: true }, "Bearer bad")))
      .status,
  ).toBe(401);
  expect(
    (
      await postPlayerTasks(
        toggleRequest({ taskId: "task-1", completed: true }, `Bearer ${token}`, "?deviceId=wrong"),
      )
    ).status,
  ).toBe(403);
  expect(
    (await postPlayerTasks(toggleRequest({ taskId: "missing", completed: true }))).status,
  ).toBe(404);

  const ok = await postPlayerTasks(toggleRequest({ taskId: "task-1", completed: true }));
  expect(ok.status).toBe(200);
  expect(await ok.json()).toEqual({
    ok: true,
    taskId: "task-1",
    completed: true,
    items: [{ id: "task-1", text: "Regar plantas", completed: true }],
  });

  const playerConfig = await (
    await getConfig(
      new Request("https://example.test/api/player/config", {
        headers: { authorization: `Bearer ${token}` },
      }),
    )
  ).json();
  expect(playerConfig.widgets.tasks.items[0].completed).toBe(true);

  const after = await (
    await getOnlineFrame(new Request(`https://example.test/api/online-frame?deviceId=${deviceId}`))
  ).json();
  expect(after.config.widgets.tasks.items[0].completed).toBe(true);

  // Quando interactive é desativado e publicado, o dispositivo recebe 403.
  expect(
    (
      await putOnlineFrame(
        adminRequest("/api/online-frame", {
          deviceId,
          expectedRevision: after.draftRevision,
          config: {
            ...after.config,
            widgets: {
              ...after.config.widgets,
              tasks: { ...after.config.widgets.tasks, interactive: false },
            },
          },
        }),
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await publishOnlineFrame(
        new Request("https://example.test/api/online-frame/publish", {
          method: "POST",
          headers: { origin: "https://example.test", "content-type": "application/json" },
          body: JSON.stringify({ deviceId, expectedRevision: after.draftRevision + 1 }),
        }),
      )
    ).status,
  ).toBe(200);
  publishedRevision = (
    await (
      await getOnlineFrame(
        new Request(`https://example.test/api/online-frame?deviceId=${deviceId}`),
      )
    ).json()
  ).publishedRevision;
  expect(
    (await postPlayerTasks(toggleRequest({ taskId: "task-1", completed: false }))).status,
  ).toBe(403);
});

async function createTaskPanel() {
  const config = onlineDashboardSchema.parse({
    widgets: {
      tasks: {
        enabled: true,
        interactive: true,
        items: [
          { id: "task-1", text: "Regar plantas", completed: false },
          { id: "task-2", text: "Comprar pão", completed: false },
        ],
      },
    },
  });
  const panel = await db.layout.create({
    data: {
      householdId,
      name: "Tarefas concorrentes",
      key: `panel:${randomUUID()}`,
      draft: config,
      draftRevision: 1,
      versions: { create: { config } },
    },
    include: { versions: true },
  });
  const version = panel.versions[0];
  await db.layout.update({ where: { id: panel.id }, data: { publishedVersionId: version.id } });
  const devices = [];
  for (let i = 0; i < 2; i++) {
    const pairing = await issuePairingCode(db, householdId, userId);
    const paired = await redeemPairingCode(db, pairing.code, `Tablet ${i}`);
    await db.device.update({
      where: { id: paired.deviceId },
      data: { activePanelId: panel.id, activePanelVersionId: version.id },
    });
    devices.push(paired);
  }
  return { panel, version, config, devices, revision: `online:${version.id}` };
}

const taskRequest = (deviceToken: string, taskId: string, revision: string, completed = true) =>
  new Request("https://example.test/api/player/tasks", {
    method: "POST",
    headers: { authorization: `Bearer ${deviceToken}`, "content-type": "application/json" },
    body: JSON.stringify({ revision, taskId, completed }),
  });

it.each([0, 1, 2])(
  "rejects a task from the previous panel without changing duplicated IDs (%s stale device reads)",
  async (staleDeviceReads) => {
    const previous = await createTaskPanel();
    const next = await createTaskPanel();
    const device = previous.devices[0];
    const staleDevice = await db.device.findUniqueOrThrow({ where: { id: device.deviceId } });
    await db.device.update({
      where: { id: device.deviceId },
      data: { activePanelId: next.panel.id, activePanelVersionId: next.version.id },
    });
    let reads = 0;
    const client = db.$extends({
      query: {
        device: {
          async findFirst({ args, query }) {
            const current = await query(args);
            if (current?.id === device.deviceId && reads++ < staleDeviceReads) return staleDevice;
            return current;
          },
        },
      },
    });
    const getter = staleDeviceReads
      ? vi.spyOn(database, "getDatabase").mockReturnValueOnce(client as unknown as typeof db)
      : null;
    try {
      const response = await postPlayerTasks(
        taskRequest(device.token, "task-1", previous.revision),
      );
      expect(response.status).toBe(409);
      if (staleDeviceReads) expect(reads).toBe(staleDeviceReads === 2 ? 3 : 2);
      for (const fixture of [previous, next]) {
        const version = await db.layoutVersion.findUniqueOrThrow({
          where: { id: fixture.version.id },
        });
        const layout = await db.layout.findUniqueOrThrow({ where: { id: fixture.panel.id } });
        expect(version.config).toEqual(fixture.version.config);
        expect(layout.draft).toEqual(fixture.config);
        expect(layout.draftRevision).toBe(1);
      }
    } finally {
      getter?.mockRestore();
    }
  },
);

it("requires a valid displayed revision for task writes", async () => {
  const fixture = await createTaskPanel();
  for (const revision of [undefined, "", "wrong", `online:${"x".repeat(129)}`]) {
    const response = await postPlayerTasks(
      new Request("https://example.test/api/player/tasks", {
        method: "POST",
        headers: {
          authorization: `Bearer ${fixture.devices[0].token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ revision, taskId: "task-1", completed: true }),
      }),
    );
    expect(response.status).toBe(400);
  }
});

it("preserves simultaneous task toggles from two devices on the same version", async () => {
  const fixture = await createTaskPanel();
  const responses = await Promise.all(
    fixture.devices.map((device, index) =>
      postPlayerTasks(taskRequest(device.token, `task-${index + 1}`, fixture.revision)),
    ),
  );
  expect(responses.map((response) => response.status)).toEqual([200, 200]);
  const version = await db.layoutVersion.findUniqueOrThrow({ where: { id: fixture.version.id } });
  const layout = await db.layout.findUniqueOrThrow({ where: { id: fixture.panel.id } });
  expect(
    readStoredOnlineDashboard(version.config).widgets.tasks.items.map((item) => item.completed),
  ).toEqual([true, true]);
  expect(
    readStoredOnlineDashboard(layout.draft).widgets.tasks.items.map((item) => item.completed),
  ).toEqual([true, true]);
  expect(layout.draftRevision).toBe(3);
});

it("retries a stale published snapshot instead of reverting another device's task", async () => {
  const fixture = await createTaskPanel();
  expect(
    (await postPlayerTasks(taskRequest(fixture.devices[0].token, "task-1", fixture.revision)))
      .status,
  ).toBe(200);
  let reads = 0;
  // Replay the snapshot an overlapping request read before the first device committed.
  const client = db.$extends({
    query: {
      layoutVersion: {
        async findFirst({ args, query }) {
          const current = await query(args);
          if (current?.id === fixture.version.id && reads++ === 0)
            return { ...current, config: fixture.version.config };
          return current;
        },
      },
    },
  });
  const getter = vi
    .spyOn(database, "getDatabase")
    .mockReturnValueOnce(client as unknown as typeof db);
  try {
    expect(
      (await postPlayerTasks(taskRequest(fixture.devices[1].token, "task-2", fixture.revision)))
        .status,
    ).toBe(200);
    expect(reads).toBe(2);
    const version = await db.layoutVersion.findUniqueOrThrow({ where: { id: fixture.version.id } });
    expect(
      readStoredOnlineDashboard(version.config).widgets.tasks.items.map((item) => item.completed),
    ).toEqual([true, true]);
    const layout = await db.layout.findUniqueOrThrow({ where: { id: fixture.panel.id } });
    expect(
      readStoredOnlineDashboard(layout.draft).widgets.tasks.items.map((item) => item.completed),
    ).toEqual([true, true]);
  } finally {
    getter.mockRestore();
  }
});

it("retries a stale draft revision and preserves a successful editor save", async () => {
  const fixture = await createTaskPanel();
  const staleLayout = await db.layout.findUniqueOrThrow({ where: { id: fixture.panel.id } });
  const saved = await savePanel(
    adminRequest("/api/panels", {
      id: fixture.panel.id,
      expectedRevision: staleLayout.draftRevision,
      config: {
        ...fixture.config,
        theme: "dark",
        widgets: {
          ...fixture.config.widgets,
          tasks: { ...fixture.config.widgets.tasks, title: "Título editado" },
        },
      },
    }),
  );
  expect(saved.status).toBe(200);
  let draftReads = 0;
  const publishedStates: boolean[] = [];
  const client = db.$extends({
    query: {
      layoutVersion: {
        async findFirst({ args, query }) {
          const current = await query(args);
          if (current?.id === fixture.version.id)
            publishedStates.push(
              readStoredOnlineDashboard(current.config).widgets.tasks.items[0].completed,
            );
          return current;
        },
      },
      layout: {
        async findUnique({ args, query }) {
          const current = await query(args);
          if (current?.id === fixture.panel.id && draftReads++ === 0) return staleLayout;
          return current;
        },
      },
    },
  });
  const getter = vi
    .spyOn(database, "getDatabase")
    .mockReturnValueOnce(client as unknown as typeof db);
  try {
    expect(
      (await postPlayerTasks(taskRequest(fixture.devices[0].token, "task-1", fixture.revision)))
        .status,
    ).toBe(200);
    expect(draftReads).toBe(2);
    // The failed draft CAS rolled the published task back before the retry.
    expect(publishedStates).toEqual([false, false]);
    const layout = await db.layout.findUniqueOrThrow({ where: { id: fixture.panel.id } });
    const config = readStoredOnlineDashboard(layout.draft);
    expect(config.theme).toBe("dark");
    expect(config.widgets.tasks.title).toBe("Título editado");
    expect(config.widgets.tasks.items[0].completed).toBe(true);
    expect(layout.draftRevision).toBe(3);
  } finally {
    getter.mockRestore();
  }
});

it("returns a conflict without persisting a partial write when retries are exhausted", async () => {
  const fixture = await createTaskPanel();
  let writes = 0;
  const client = db.$extends({
    query: {
      layoutVersion: {
        async updateMany() {
          writes++;
          return { count: 0 };
        },
      },
    },
  });
  const getter = vi
    .spyOn(database, "getDatabase")
    .mockReturnValueOnce(client as unknown as typeof db);
  try {
    expect(
      (await postPlayerTasks(taskRequest(fixture.devices[0].token, "task-1", fixture.revision)))
        .status,
    ).toBe(409);
    expect(writes).toBe(5);
    const version = await db.layoutVersion.findUniqueOrThrow({ where: { id: fixture.version.id } });
    const layout = await db.layout.findUniqueOrThrow({ where: { id: fixture.panel.id } });
    expect(version.config).toEqual(fixture.version.config);
    expect(layout.draftRevision).toBe(1);
  } finally {
    getter.mockRestore();
  }
});

it("does not swallow draft database errors or commit the published task on failure", async () => {
  const fixture = await createTaskPanel();
  const client = db.$extends({
    query: {
      layout: {
        async updateMany() {
          throw new Error("Database write failed");
        },
      },
    },
  });
  const getter = vi
    .spyOn(database, "getDatabase")
    .mockReturnValueOnce(client as unknown as typeof db);
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    expect(
      (await postPlayerTasks(taskRequest(fixture.devices[0].token, "task-1", fixture.revision)))
        .status,
    ).toBe(500);
    const version = await db.layoutVersion.findUniqueOrThrow({ where: { id: fixture.version.id } });
    expect(version.config).toEqual(fixture.version.config);
  } finally {
    getter.mockRestore();
    log.mockRestore();
  }
});

it.each(["P2034", "P1008"])("retries transient transaction error %s", async (code) => {
  const fixture = await createTaskPanel();
  let writes = 0;
  const client = db.$extends({
    query: {
      layoutVersion: {
        async updateMany({ args, query }) {
          if (writes++ === 0) throw Object.assign(new Error("Transient conflict"), { code });
          return query(args);
        },
      },
    },
  });
  const getter = vi
    .spyOn(database, "getDatabase")
    .mockReturnValueOnce(client as unknown as typeof db);
  try {
    expect(
      (await postPlayerTasks(taskRequest(fixture.devices[0].token, "task-1", fixture.revision)))
        .status,
    ).toBe(200);
    expect(writes).toBe(2);
  } finally {
    getter.mockRestore();
  }
});

it("keeps toggles on an older pinned publication out of the current draft and future publications", async () => {
  const fixture = await createTaskPanel();
  const publish = (expectedRevision: number) =>
    publishOnlinePanel(db, {
      householdId,
      panelId: fixture.panel.id,
      deviceId: fixture.devices[1].deviceId,
      expectedRevision,
      activate: true,
    });
  const newerRevision = await publish(1);
  expect(
    (await postPlayerTasks(taskRequest(fixture.devices[1].token, "task-1", newerRevision))).status,
  ).toBe(200);
  expect(
    (await postPlayerTasks(taskRequest(fixture.devices[1].token, "task-1", newerRevision, false)))
      .status,
  ).toBe(200);
  const before = await db.layout.findUniqueOrThrow({ where: { id: fixture.panel.id } });

  expect(
    (await postPlayerTasks(taskRequest(fixture.devices[0].token, "task-1", fixture.revision)))
      .status,
  ).toBe(200);
  const oldVersion = await db.layoutVersion.findUniqueOrThrow({
    where: { id: fixture.version.id },
  });
  expect(readStoredOnlineDashboard(oldVersion.config).widgets.tasks.items[0].completed).toBe(true);
  const newerVersion = await db.layoutVersion.findUniqueOrThrow({
    where: { id: newerRevision.slice("online:".length) },
  });
  expect(readStoredOnlineDashboard(newerVersion.config).widgets.tasks.items[0].completed).toBe(
    false,
  );
  const after = await db.layout.findUniqueOrThrow({ where: { id: fixture.panel.id } });
  expect(after.draft).toEqual(before.draft);
  expect(after.draftRevision).toBe(before.draftRevision);

  const nextRevision = await publish(after.draftRevision);
  const nextVersion = await db.layoutVersion.findUniqueOrThrow({
    where: { id: nextRevision.slice("online:".length) },
  });
  expect(readStoredOnlineDashboard(nextVersion.config).widgets.tasks.items[0].completed).toBe(
    false,
  );
});

it("checks the publication pointer as well as the draft revision during a concurrent publication", async () => {
  const fixture = await createTaskPanel();
  const staleLayout = await db.layout.findUniqueOrThrow({ where: { id: fixture.panel.id } });
  await publishOnlinePanel(db, {
    householdId,
    panelId: fixture.panel.id,
    deviceId: fixture.devices[1].deviceId,
    expectedRevision: staleLayout.draftRevision,
    activate: true,
  });
  let draftReads = 0;
  const client = db.$extends({
    query: {
      layout: {
        async findUnique({ args, query }) {
          const current = await query(args);
          if (current?.id === fixture.panel.id && draftReads++ === 0) return staleLayout;
          return current;
        },
      },
    },
  });
  const getter = vi
    .spyOn(database, "getDatabase")
    .mockReturnValueOnce(client as unknown as typeof db);
  try {
    expect(
      (await postPlayerTasks(taskRequest(fixture.devices[0].token, "task-1", fixture.revision)))
        .status,
    ).toBe(200);
    expect(draftReads).toBe(2);
    const layout = await db.layout.findUniqueOrThrow({ where: { id: fixture.panel.id } });
    expect(layout.draft).toEqual(staleLayout.draft);
    expect(layout.draftRevision).toBe(staleLayout.draftRevision);
  } finally {
    getter.mockRestore();
  }
});

it("requests preview provider data for page-enabled widgets even with their global flags disabled", async () => {
  const config = onlineDashboardSchema.parse({
    widgets: {
      system: { enabled: false },
      rss: { enabled: false, feedUrl: "https://feeds.example.com/rss.xml" },
      devMonitor: { enabled: false },
    },
    pages: [{ id: "metrics", title: "Métricas", enabledWidgets: ["system", "rss", "devMonitor"] }],
  });
  const response = await previewWidgets(
    new Request("https://example.test/api/online-frame/widgets", {
      method: "POST",
      headers: { origin: "https://example.test", "content-type": "application/json" },
      body: JSON.stringify({ widgets: previewWidgetSettings(config) }),
    }),
  );
  expect(response.status).toBe(200);
  expect(onlineWidgetDataMock.mock.calls.at(-1)?.[1]).toMatchObject({
    system: { enabled: true },
    rss: { enabled: true, feedUrl: "https://feeds.example.com/rss.xml" },
    devMonitor: { enabled: true },
  });
});
