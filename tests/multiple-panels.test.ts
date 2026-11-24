import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import * as database from "@smartframe/database";
import { issuePairingCode, redeemPairingCode } from "@smartframe/frames";
import {
  activeOnlineVersion,
  activeOnlineVersionWithDevice,
} from "../apps/web/src/lib/active-online-version";

vi.mock("server-only", () => ({}));
const panelAccess = vi.hoisted(() => vi.fn());
vi.mock("../apps/web/src/lib/panel-access", () => ({ panelAccess }));
vi.mock("@smartframe/widgets", async (original) => ({
  ...(await original<typeof import("@smartframe/widgets")>()),
  onlineWidgetData: vi.fn(async () => ({ refreshSeconds: 1800, weather: null, currencies: {} })),
}));

import { GET, POST, PUT, PATCH, DELETE } from "../apps/web/src/app/api/panels/route";
import { POST as publish } from "../apps/web/src/app/api/panels/publish/route";
import {
  GET as getLegacyFrame,
  PUT as saveLegacy,
} from "../apps/web/src/app/api/online-frame/route";
import { GET as listDevices } from "../apps/web/src/app/api/devices/route";
import { POST as publishLegacy } from "../apps/web/src/app/api/online-frame/publish/route";
import { GET as playerConfig } from "../apps/web/src/app/api/player/config/route";
import { GET as playerMedia } from "../apps/web/src/app/api/player/online-media/[id]/route";
import {
  GET as listOptions,
  POST as switchPanel,
} from "../apps/web/src/app/api/player/panels/route";
import { POST as completeTask } from "../apps/web/src/app/api/player/tasks/route";
import {
  GET as adminOptions,
  DELETE as removeOption,
} from "../apps/web/src/app/api/devices/panels/route";

const db = database.getDatabase();
const userId = randomUUID();
let householdId: string;
let first: { deviceId: string; token: string };
let second: { deviceId: string; token: string };
const request = (method: string, body?: unknown, path = "/api/panels") =>
  new Request(`https://example.test${path}`, {
    method,
    headers: {
      origin: "https://example.test",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
const player = (token: string) =>
  playerConfig(
    new Request("https://example.test/api/player/config", {
      headers: { authorization: `Bearer ${token}` },
    }),
  );

beforeAll(async () => {
  process.env.BETTER_AUTH_URL = "https://example.test";
  const user = await db.user.create({
    data: {
      id: userId,
      name: "Test",
      email: `${userId}@test.local`,
      household: { create: { name: "Casa" } },
    },
    include: { household: true },
  });
  householdId = user.household!.id;
  panelAccess.mockResolvedValue({ household: { id: householdId }, user: { id: userId } });
  const pair = async (name: string) => {
    const code = await issuePairingCode(db, householdId, userId);
    return redeemPairingCode(db, code.code, name);
  };
  first = await pair("Tablet 1");
  second = await pair("Tablet 2");
});
afterAll(async () => {
  await db.household.deleteMany({ where: { ownerId: userId } });
  await db.user.deleteMany({ where: { id: userId } });
  await db.$disconnect();
});

it("preserves existing drafts, published versions, credentials and applied revisions in migration", () => {
  const sqlite = new DatabaseSync(":memory:");
  try {
    sqlite.exec(`CREATE TABLE Device (id TEXT PRIMARY KEY, householdId TEXT, tokenHash TEXT, appliedRevision TEXT);
      CREATE TABLE Layout (id TEXT PRIMARY KEY, householdId TEXT, key TEXT, draft TEXT, publishedVersionId TEXT);
      CREATE TABLE LayoutVersion (id TEXT PRIMARY KEY, layoutId TEXT, config TEXT);
      INSERT INTO Device VALUES ('d', 'h', 'secret-hash', 'online:v');
      INSERT INTO Layout VALUES ('l', 'h', 'online:d', '{"refreshSeconds":30}', 'v');
      INSERT INTO LayoutVersion VALUES ('v', 'l', '{"refreshSeconds":20}');`);
    sqlite.exec(
      readFileSync(
        "packages/database/prisma/migrations/20261103120000_multiple_online_panels/migration.sql",
        "utf8",
      ),
    );
    expect(
      sqlite
        .prepare(
          "SELECT activePanelId, activePanelVersionId, tokenHash, appliedRevision FROM Device",
        )
        .get(),
    ).toEqual({
      activePanelId: "l",
      activePanelVersionId: "v",
      tokenHash: "secret-hash",
      appliedRevision: "online:v",
    });
    expect(sqlite.prepare("SELECT draft FROM Layout WHERE id = 'l'").get()?.draft).toBe(
      '{"refreshSeconds":30}',
    );
    expect(sqlite.prepare("SELECT config FROM LayoutVersion WHERE id = 'v'").get()?.config).toBe(
      '{"refreshSeconds":20}',
    );
  } finally {
    sqlite.close();
  }
});

it("migrates only each active, valid publication into device permissions", () => {
  const sqlite = new DatabaseSync(":memory:");
  try {
    sqlite.exec(`CREATE TABLE Device (id TEXT PRIMARY KEY, householdId TEXT, activePanelId TEXT, activePanelVersionId TEXT, revokedAt TEXT);
      CREATE TABLE Layout (id TEXT PRIMARY KEY, householdId TEXT);
      CREATE TABLE LayoutVersion (id TEXT PRIMARY KEY, layoutId TEXT);
      INSERT INTO Layout VALUES ('a','home'),('b','home'),('foreign','other');
      INSERT INTO LayoutVersion VALUES ('va','a'),('vb','b'),('vf','foreign');
      INSERT INTO Device VALUES ('d','home','a','va',NULL),('bad','home','foreign','vf',NULL),('revoked','home','b','vb','now');`);
    sqlite.exec(
      readFileSync(
        "packages/database/prisma/migrations/20261106120000_device_panel_access/migration.sql",
        "utf8",
      ),
    );
    expect(sqlite.prepare('SELECT * FROM "DevicePanelAccess"').all()).toEqual([
      { deviceId: "d", panelId: "a", versionId: "va" },
    ]);
  } finally {
    sqlite.close();
  }
});

it("manages independent drafts and publishes immutable versions to selected devices", async () => {
  const create = await POST(request("POST", { name: "Casa" }));
  expect(create.status).toBe(201);
  const a = (await create.json()).id;
  const copied = await POST(request("POST", { name: "Trabalho", copyFromId: a }));
  const b = (await copied.json()).id;
  expect((await GET(request("GET"))).status).toBe(200);
  expect((await PATCH(request("PATCH", { id: b, name: "Escritório" }))).status).toBe(200);
  expect(
    (await PUT(request("PUT", { id: a, expectedRevision: 1, config: { refreshSeconds: 20 } })))
      .status,
  ).toBe(200);
  expect((await PUT(request("PUT", { id: a, expectedRevision: 1, config: {} }))).status).toBe(409);
  expect(
    (await (await GET(request("GET", undefined, `?id=${b}`))).json()).config.refreshSeconds,
  ).toBe(15);
  const send = (panelId: string, deviceId: string, expectedRevision: number) =>
    publish(request("POST", { panelId, deviceId, expectedRevision }, "/api/panels/publish"));
  const firstPublication = await send(a, first.deviceId, 2);
  expect(firstPublication.status).toBe(200);
  const firstRevision = (await firstPublication.json()).revision;
  expect((await send(a, second.deviceId, 2)).status).toBe(200);
  expect(
    (await PUT(request("PUT", { id: a, expectedRevision: 2, config: { refreshSeconds: 30 } })))
      .status,
  ).toBe(200);
  expect((await (await player(first.token)).json()).refreshSeconds).toBe(20);
  expect((await send(a, first.deviceId, 3)).status).toBe(200);
  expect((await (await player(first.token)).json()).refreshSeconds).toBe(30);
  const ack = (revision: string) =>
    playerConfig(
      new Request(
        `https://example.test/api/player/config?appliedRevision=${encodeURIComponent(revision)}`,
        { headers: { authorization: `Bearer ${first.token}` } },
      ),
    );
  await ack(firstRevision);
  expect(
    (await db.device.findUniqueOrThrow({ where: { id: first.deviceId } })).appliedRevision,
  ).toBeNull();
  const currentRevision = (await (await player(first.token)).json()).revision;
  await ack(currentRevision);
  expect(
    (await db.device.findUniqueOrThrow({ where: { id: first.deviceId } })).appliedRevision,
  ).toBe(currentRevision);
  expect((await (await player(second.token)).json()).refreshSeconds).toBe(20);
  expect((await DELETE(request("DELETE", { id: a }))).status).toBe(409);
  expect((await send(b, first.deviceId, 1)).status).toBe(200);
  expect((await send(b, second.deviceId, 1)).status).toBe(200);
  expect((await DELETE(request("DELETE", { id: a }))).status).toBe(200);
  expect((await (await player(first.token)).json()).refreshSeconds).toBe(15);
  expect((await send(b, first.deviceId, 99)).status).toBe(409);
  expect(
    (
      await PUT(
        request("PUT", {
          id: b,
          expectedRevision: 1,
          config: { widgets: { photos: { photoIds: [randomUUID()] } } },
        }),
      )
    ).status,
  ).toBe(200);
  expect((await send(b, first.deviceId, 2)).status).toBe(400);
  expect((await (await player(first.token)).json()).refreshSeconds).toBe(15);
});

it("rejects unauthenticated, cross-origin and cross-household operations", async () => {
  const created = await POST(request("POST", { name: "Privado" }));
  const id = (await created.json()).id;
  const foreignUser = randomUUID();
  const foreign = await db.user.create({
    data: {
      id: foreignUser,
      name: "Outro",
      email: `${foreignUser}@test.local`,
      household: { create: { name: "Outra casa" } },
    },
    include: { household: true },
  });
  try {
    panelAccess.mockResolvedValueOnce(null);
    expect((await GET(request("GET"))).status).toBe(401);
    const wrongOrigin = new Request("https://example.test/api/panels", {
      method: "POST",
      headers: { origin: "https://other.test", "content-type": "application/json" },
      body: JSON.stringify({ name: "Inválido" }),
    });
    expect((await POST(wrongOrigin)).status).toBe(403);
    panelAccess.mockResolvedValue({
      household: { id: foreign.household!.id },
      user: { id: foreignUser },
    });
    expect((await GET(request("GET", undefined, `?id=${id}`))).status).toBe(404);
    expect((await POST(request("POST", { name: "Cópia", copyFromId: id }))).status).toBe(404);
    expect((await DELETE(request("DELETE", { id }))).status).toBe(404);
    expect(
      (
        await adminOptions(
          request("GET", undefined, `/api/devices/panels?deviceId=${first.deviceId}`),
        )
      ).status,
    ).toBe(404);
    expect(
      (await removeOption(request("DELETE", { deviceId: first.deviceId, panelId: id }))).status,
    ).toBe(404);
    expect(
      (
        await publish(
          request("POST", { panelId: id, deviceId: first.deviceId, expectedRevision: 1 }),
        )
      ).status,
    ).toBe(404);
  } finally {
    panelAccess.mockResolvedValue({ household: { id: householdId }, user: { id: userId } });
    await db.household.deleteMany({ where: { ownerId: foreignUser } });
    await db.user.deleteMany({ where: { id: foreignUser } });
  }
});

it("does not expose photos from a panel assigned to a different device", async () => {
  const photo = await db.media.create({
    data: {
      householdId,
      filename: "privada.webp",
      status: "ready",
      sha256: "abc",
      bytes: 10,
      width: 10,
      height: 10,
    },
  });
  const create = await POST(request("POST", { name: "Com foto" }));
  const id = (await create.json()).id;
  expect(
    (
      await PUT(
        request("PUT", {
          id,
          expectedRevision: 1,
          config: { widgets: { photos: { photoIds: [photo.id] } } },
        }),
      )
    ).status,
  ).toBe(200);
  expect(
    (await publish(request("POST", { panelId: id, deviceId: first.deviceId, expectedRevision: 2 })))
      .status,
  ).toBe(200);
  const response = await playerMedia(
    new Request(`https://example.test/api/player/online-media/${photo.id}`, {
      headers: { authorization: `Bearer ${second.token}` },
    }),
    { params: Promise.resolve({ id: photo.id }) },
  );
  expect(response.status).toBe(404);
  expect((await (await player(first.token)).json()).widgets.photos.items[0].id).toBe(photo.id);
});

it("allows only explicitly approved versions to be switched per device", async () => {
  const a = (await (await POST(request("POST", { name: "Seleção A" }))).json()).id;
  const b = (await (await POST(request("POST", { name: "Seleção B" }))).json()).id;
  const send = (panelId: string, deviceId: string, expectedRevision: number, activate = true) =>
    publish(request("POST", { panelId, deviceId, expectedRevision, activate }));
  const options = (token: string) =>
    listOptions(
      new Request("https://example.test/api/player/panels", {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
  const choose = (token: string, panelId: string) =>
    switchPanel(
      new Request("https://example.test/api/player/panels", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ panelId }),
      }),
    );
  expect((await send(a, first.deviceId, 1)).status).toBe(200);
  expect((await send(a, second.deviceId, 1)).status).toBe(200);
  expect((await choose(first.token, b)).status).toBe(404);
  expect((await send(b, first.deviceId, 1, false)).status).toBe(200);
  const initial = await db.device.findUniqueOrThrow({ where: { id: first.deviceId } });
  expect(initial.activePanelId).toBe(a);
  const firstList = await (await options(first.token)).json();
  expect(firstList.panels.map((panel: { id: string }) => panel.id)).toContain(b);
  expect(
    (await (await options(second.token)).json()).panels.map((panel: { id: string }) => panel.id),
  ).not.toContain(b);
  expect((await choose(second.token, b)).status).toBe(404);
  const approved = await db.devicePanelAccess.findUniqueOrThrow({
    where: { deviceId_panelId: { deviceId: first.deviceId, panelId: b } },
  });
  expect(
    (await PUT(request("PUT", { id: b, expectedRevision: 1, config: { refreshSeconds: 45 } })))
      .status,
  ).toBe(200);
  expect((await send(b, second.deviceId, 2)).status).toBe(200);
  expect((await choose(first.token, b)).status).toBe(200);
  expect((await (await player(first.token)).json()).revision).toBe(`online:${approved.versionId}`);
  await playerConfig(
    new Request(
      `https://example.test/api/player/config?appliedRevision=${encodeURIComponent(`online:${approved.versionId}`)}`,
      { headers: { authorization: `Bearer ${first.token}` } },
    ),
  );
  expect((await choose(first.token, b)).status).toBe(200);
  expect(
    (await db.device.findUniqueOrThrow({ where: { id: first.deviceId } })).appliedRevision,
  ).toBe(`online:${approved.versionId}`);
  expect((await (await player(first.token)).json()).refreshSeconds).toBe(15);
  expect((await (await player(second.token)).json()).refreshSeconds).toBe(45);
  expect(
    (await removeOption(request("DELETE", { deviceId: first.deviceId, panelId: b }))).status,
  ).toBe(409);
  expect((await choose(first.token, a)).status).toBe(200);
  expect(
    (await db.device.findUniqueOrThrow({ where: { id: first.deviceId } })).appliedRevision,
  ).toBeNull();
  expect(
    (await removeOption(request("DELETE", { deviceId: first.deviceId, panelId: b }))).status,
  ).toBe(200);
  expect((await choose(first.token, b)).status).toBe(404);
  expect(
    (
      await adminOptions(
        request("GET", undefined, `/api/devices/panels?deviceId=${first.deviceId}`),
      )
    ).status,
  ).toBe(200);
  expect((await options("invalid-token")).status).toBe(401);
  await db.device.update({ where: { id: first.deviceId }, data: { revokedAt: new Date() } });
  try {
    expect((await choose(first.token, a)).status).toBe(401);
  } finally {
    await db.device.update({ where: { id: first.deviceId }, data: { revokedAt: null } });
  }
});

it("keeps legacy publications and approved versions in sync without changing other devices", async () => {
  const pairing = await issuePairingCode(db, householdId, userId);
  const paired = await redeemPairingCode(db, pairing.code, "Compatibilidade");
  const save = (expectedRevision: number, refreshSeconds: number) =>
    saveLegacy(
      request("PUT", { deviceId: paired.deviceId, expectedRevision, config: { refreshSeconds } }),
    );
  const send = (expectedRevision: number) =>
    publishLegacy(request("POST", { deviceId: paired.deviceId, expectedRevision }));
  const playerRequest = (method = "GET", body?: unknown) =>
    new Request("https://example.test/api/player/panels", {
      method,
      headers: { authorization: `Bearer ${paired.token}`, "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  expect((await save(0, 15)).status).toBe(200);
  expect((await send(1)).status).toBe(200);
  const panel = await db.layout.findUniqueOrThrow({ where: { key: `online:${paired.deviceId}` } });
  const accessKey = { deviceId_panelId: { deviceId: paired.deviceId, panelId: panel.id } };
  expect(await db.devicePanelAccess.findUnique({ where: accessKey })).not.toBeNull();

  expect(
    (
      await publish(
        request("POST", { panelId: panel.id, deviceId: second.deviceId, expectedRevision: 1 }),
      )
    ).status,
  ).toBe(200);
  const otherAccess = await db.devicePanelAccess.findUniqueOrThrow({
    where: { deviceId_panelId: { deviceId: second.deviceId, panelId: panel.id } },
  });
  expect((await save(1, 45)).status).toBe(200);
  const publication = await send(2);
  expect(publication.status).toBe(200);
  const revision = (await publication.json()).revision;
  const options = await (await listOptions(playerRequest())).json();
  expect(options.panels).toEqual([
    expect.objectContaining({ id: panel.id, current: true, updateAvailable: false }),
  ]);
  const chosen = await switchPanel(playerRequest("POST", { panelId: panel.id }));
  expect(chosen.status).toBe(200);
  expect((await chosen.json()).revision).toBe(revision);
  expect((await (await player(paired.token)).json()).refreshSeconds).toBe(45);
  expect((await (await player(second.token)).json()).refreshSeconds).toBe(15);
  expect(
    (
      await db.devicePanelAccess.findUniqueOrThrow({
        where: { deviceId_panelId: { deviceId: second.deviceId, panelId: panel.id } },
      })
    ).versionId,
  ).toBe(otherAccess.versionId);

  const versionCount = await db.layoutVersion.count({ where: { layoutId: panel.id } });
  expect((await send(1)).status).toBe(409);
  expect(await db.layoutVersion.count({ where: { layoutId: panel.id } })).toBe(versionCount);

  const other = (await (await POST(request("POST", { name: "Painel selecionado" }))).json()).id;
  expect(
    (
      await publish(
        request("POST", { panelId: other, deviceId: paired.deviceId, expectedRevision: 1 }),
      )
    ).status,
  ).toBe(200);
  expect((await save(2, 60)).status).toBe(200);
  expect((await send(3)).status).toBe(200);
  expect(
    (await db.device.findUniqueOrThrow({ where: { id: paired.deviceId } })).activePanelId,
  ).toBe(other);
  expect((await switchPanel(playerRequest("POST", { panelId: panel.id }))).status).toBe(200);
  expect((await (await player(paired.token)).json()).refreshSeconds).toBe(60);
});

it("does not activate a legacy device fallback when publishing with activate=false", async () => {
  const pairing = await issuePairingCode(db, householdId, userId);
  const legacyDevice = await redeemPairingCode(db, pairing.code, "Legacy Fallback");
  const otherPairing = await issuePairingCode(db, householdId, userId);
  const otherDevice = await redeemPairingCode(db, otherPairing.code, "Other Tablet");
  expect(
    (
      await saveLegacy(
        request("PUT", {
          deviceId: legacyDevice.deviceId,
          expectedRevision: 0,
          config: { refreshSeconds: 25 },
        }),
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await publishLegacy(
        request("POST", { deviceId: legacyDevice.deviceId, expectedRevision: 1 }),
      )
    ).status,
  ).toBe(200);
  // Clear activePanelId to simulate a pre-migration legacy device whose fallback reads publishedVersionId.
  await db.device.update({
    where: { id: legacyDevice.deviceId },
    data: { activePanelId: null, activePanelVersionId: null },
  });
  const legacyLayout = await db.layout.findUniqueOrThrow({
    where: { key: `online:${legacyDevice.deviceId}` },
  });
  // Deleting the fallback panel while served by activePanelId === null must be blocked.
  expect((await DELETE(request("DELETE", { id: legacyLayout.id }))).status).toBe(409);
  expect(
    (
      await saveLegacy(
        request("PUT", {
          deviceId: legacyDevice.deviceId,
          expectedRevision: 1,
          config: {
            refreshSeconds: 45,
            widgets: {
              tasks: {
                enabled: true,
                interactive: true,
                items: [{ id: "t-cross", text: "Regar plantas", completed: false }],
              },
            },
          },
        }),
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await publish(
        request(
          "POST",
          {
            panelId: legacyLayout.id,
            deviceId: legacyDevice.deviceId,
            expectedRevision: 2,
            activate: false,
          },
          "/api/panels/publish",
        ),
      )
    ).status,
  ).toBe(200);
  expect((await (await player(legacyDevice.token)).json()).refreshSeconds).toBe(25);
  const crossPublish = await publish(
    request(
      "POST",
      {
        panelId: legacyLayout.id,
        deviceId: otherDevice.deviceId,
        expectedRevision: 2,
        activate: true,
      },
      "/api/panels/publish",
    ),
  );
  const staleLegacySnapshot = await db.device.findUniqueOrThrow({
    where: { id: legacyDevice.deviceId },
    select: { id: true, householdId: true, activePanelId: true, activePanelVersionId: true },
  });
  expect(crossPublish.status).toBe(200);
  const crossRevision = (await crossPublish.json()).revision as string;
  expect((await (await player(legacyDevice.token)).json()).refreshSeconds).toBe(25);
  expect(
    ((await activeOnlineVersion(db, staleLegacySnapshot))?.config as { refreshSeconds?: number })
      ?.refreshSeconds,
  ).toBe(25);
  const otherConfig = await (await player(otherDevice.token)).json();
  expect(otherConfig.refreshSeconds).toBe(45);
  const taskToggle = await completeTask(
    new Request("https://example.test/api/player/tasks", {
      method: "POST",
      headers: {
        authorization: `Bearer ${otherDevice.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        revision: crossRevision,
        taskId: "t-cross",
        completed: true,
      }),
    }),
  );
  expect(taskToggle.status).toBe(200);
  const updatedPanelState = await (await GET(request("GET", undefined, `?id=${legacyLayout.id}`))).json();
  expect(updatedPanelState.config.widgets.tasks.items[0]?.completed).toBe(true);
  const options = await (
    await listOptions(
      new Request("https://example.test/api/player/panels", {
        headers: { authorization: `Bearer ${otherDevice.token}` },
      }),
    )
  ).json();
  expect(options.panels.map((item: { id: string }) => item.id)).toContain(legacyLayout.id);
  const replacementPanelId = (
    await (await POST(request("POST", { name: "Substituto Legado" }))).json()
  ).id as string;
  expect(
    (
      await PUT(
        request("PUT", {
          id: replacementPanelId,
          expectedRevision: 1,
          config: { refreshSeconds: 60 },
        }),
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await publish(
        request(
          "POST",
          {
            panelId: replacementPanelId,
            deviceId: legacyDevice.deviceId,
            expectedRevision: 2,
            activate: true,
          },
          "/api/panels/publish",
        ),
      )
    ).status,
  ).toBe(200);
  // Stale pre-switch snapshot must re-read committed device state consistently with version lookup.
  expect(
    ((await activeOnlineVersion(db, staleLegacySnapshot))?.config as { refreshSeconds?: number })
      ?.refreshSeconds,
  ).toBe(60);
  expect(
    (
      await publish(
        request(
          "POST",
          {
            panelId: replacementPanelId,
            deviceId: otherDevice.deviceId,
            expectedRevision: 2,
            activate: true,
          },
          "/api/panels/publish",
        ),
      )
    ).status,
  ).toBe(200);
  expect((await DELETE(request("DELETE", { id: legacyLayout.id }))).status).toBe(200);
});

it("does not activate an unpublished legacy draft when publishing with activate=false or to another device", async () => {
  const pairingA = await issuePairingCode(db, householdId, userId);
  const draftDevice = await redeemPairingCode(db, pairingA.code, "Draft Owner");
  const pairingB = await issuePairingCode(db, householdId, userId);
  const peerDevice = await redeemPairingCode(db, pairingB.code, "Peer Tablet");

  expect(
    (
      await saveLegacy(
        request("PUT", {
          deviceId: draftDevice.deviceId,
          expectedRevision: 0,
          config: {
            refreshSeconds: 33,
            widgets: {
              tasks: {
                enabled: true,
                interactive: true,
                items: [{ id: "t-unpub", text: "Conferir estoque", completed: false }],
              },
            },
          },
        }),
      )
    ).status,
  ).toBe(200);
  const draftLayout = await db.layout.findUniqueOrThrow({
    where: { key: `online:${draftDevice.deviceId}` },
  });
  expect(draftLayout.publishedVersionId).toBeNull();

  // Making the unpublished legacy draft available to its own owner (activate=false) must not activate it.
  expect(
    (
      await publish(
        request(
          "POST",
          {
            panelId: draftLayout.id,
            deviceId: draftDevice.deviceId,
            expectedRevision: 1,
            activate: false,
          },
          "/api/panels/publish",
        ),
      )
    ).status,
  ).toBe(200);
  expect((await player(draftDevice.token)).status).toBe(409);

  // Publishing the unpublished legacy draft to another tablet (activate=true) must leave draftDevice unconfigured,
  // serve it to peerDevice, and sync task completions back to the panel draft.
  const peerPublish = await publish(
    request(
      "POST",
      {
        panelId: draftLayout.id,
        deviceId: peerDevice.deviceId,
        expectedRevision: 1,
        activate: true,
      },
      "/api/panels/publish",
    ),
  );
  expect(peerPublish.status).toBe(200);
  const peerRevision = (await peerPublish.json()).revision as string;
  expect((await player(draftDevice.token)).status).toBe(409);
  expect((await (await player(peerDevice.token)).json()).refreshSeconds).toBe(33);

  const peerTask = await completeTask(
    new Request("https://example.test/api/player/tasks", {
      method: "POST",
      headers: {
        authorization: `Bearer ${peerDevice.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        revision: peerRevision,
        taskId: "t-unpub",
        completed: true,
      }),
    }),
  );
  expect(peerTask.status).toBe(200);
  const reloadedDraft = await (await GET(request("GET", undefined, `?id=${draftLayout.id}`))).json();
  expect(reloadedDraft.config.widgets.tasks.items[0]?.completed).toBe(true);
});

it("drops a stale pageDirective when a concurrent panel publish clears targetPageId before player config resolves", async () => {
  const pairing = await issuePairingCode(db, householdId, userId);
  const concurrentDevice = await redeemPairingCode(db, pairing.code, "Concurrent Player");
  const pages = [
    { id: "p1", title: "Pagina 1", enabledWidgets: ["clock"] },
    { id: "p2", title: "Pagina 2", enabledWidgets: ["weather"] },
  ];
  const panelAId = (
    await (await POST(request("POST", { name: "Painel A Paginado" }))).json()
  ).id as string;
  const panelBId = (
    await (await POST(request("POST", { name: "Painel B Novo" }))).json()
  ).id as string;
  expect(
    (await PUT(request("PUT", { id: panelAId, expectedRevision: 1, config: { refreshSeconds: 20, pages } }))).status,
  ).toBe(200);
  expect(
    (await PUT(request("PUT", { id: panelBId, expectedRevision: 1, config: { refreshSeconds: 50, pages } }))).status,
  ).toBe(200);
  expect(
    (
      await publish(
        request(
          "POST",
          { panelId: panelAId, deviceId: concurrentDevice.deviceId, expectedRevision: 2, activate: true },
          "/api/panels/publish",
        ),
      )
    ).status,
  ).toBe(200);

  await db.device.update({
    where: { id: concurrentDevice.deviceId },
    data: {
      targetPageId: "next",
      targetPageNonce: "nonce-stale",
      targetPageDuration: 30,
      targetPageExpiresAt: new Date(Date.now() + 60_000),
    },
  });
  const staleAuthorizedDevice = await db.device.findUniqueOrThrow({
    where: { id: concurrentDevice.deviceId },
  });
  expect(staleAuthorizedDevice.targetPageId).toBe("next");

  expect(
    (
      await publish(
        request(
          "POST",
          { panelId: panelBId, deviceId: concurrentDevice.deviceId, expectedRevision: 2, activate: true },
          "/api/panels/publish",
        ),
      )
    ).status,
  ).toBe(200);

  const resolved = await activeOnlineVersionWithDevice(db, staleAuthorizedDevice);
  expect(resolved?.device.activePanelId).toBe(panelBId);
  expect(resolved?.device.targetPageId).toBeNull();
  expect((resolved?.version.config as { refreshSeconds?: number })?.refreshSeconds).toBe(50);

  let deviceReads = 0;
  const extendedDb = db.$extends({
    query: {
      device: {
        async findFirst({ args, query }) {
          const current = await query(args);
          if (current?.id === concurrentDevice.deviceId && deviceReads++ === 0) {
            return staleAuthorizedDevice;
          }
          return current;
        },
      },
    },
  });
  const spy = vi
    .spyOn(database, "getDatabase")
    .mockReturnValueOnce(extendedDb as unknown as typeof db);
  try {
    const response = await player(concurrentDevice.token);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.refreshSeconds).toBe(50);
    expect(body.pageDirective).toBeUndefined();
    expect(deviceReads).toBe(2);
  } finally {
    spy.mockRestore();
  }
});

it("scopes /api/online-frame GET by household and omits draft in summary mode", async () => {
  const pairing = await issuePairingCode(db, householdId, userId);
  const owned = await redeemPairingCode(db, pairing.code, "Summary Device");
  const foreignUser = randomUUID();
  const foreign = await db.user.create({
    data: {
      id: foreignUser,
      name: "Foreign Legacy Owner",
      email: `${foreignUser}@test.local`,
      household: { create: { name: "Foreign Legacy House" } },
    },
    include: { household: true },
  });

  try {
    // Even if a layout with key online:<owned.deviceId> belongs to another household,
    // GET /api/online-frame must never read or return its draft or version.
    const foreignLayout = await db.layout.create({
      data: {
        householdId: foreign.household!.id,
        key: `online:${owned.deviceId}`,
        name: "Foreign Secret Legacy",
        draft: { refreshSeconds: 59, widgets: { notes: { enabled: true, title: "Segredo", items: [] } } },
        draftRevision: 3,
      },
    });
    const foreignVersion = await db.layoutVersion.create({
      data: { layoutId: foreignLayout.id, config: { refreshSeconds: 59 } },
    });
    await db.layout.update({
      where: { id: foreignLayout.id },
      data: { publishedVersionId: foreignVersion.id },
    });

    const summaryRes = await getLegacyFrame(
      request("GET", undefined, `/api/online-frame?deviceId=${owned.deviceId}&summary=1`),
    );
    expect(summaryRes.status).toBe(200);
    const summaryBody = await summaryRes.json();
    expect(summaryBody).toEqual({
      deviceId: owned.deviceId,
      publishedRevision: null,
      appliedRevision: null,
      lastSeenAt: null,
    });
    expect("config" in summaryBody).toBe(false);
    expect("draftRevision" in summaryBody).toBe(false);

    const fullRes = await getLegacyFrame(
      request("GET", undefined, `/api/online-frame?deviceId=${owned.deviceId}`),
    );
    expect(fullRes.status).toBe(200);
    const fullBody = await fullRes.json();
    expect(fullBody.publishedRevision).toBeNull();
    expect(fullBody.draftRevision).toBe(0);
    expect(fullBody.config.refreshSeconds).toBe(15);
  } finally {
    await db.household.deleteMany({ where: { ownerId: foreignUser } });
    await db.user.deleteMany({ where: { id: foreignUser } });
  }
});

it("resolves an explicitly requested non-revoked household device beyond the first 100 in /api/devices", async () => {
  const bulkOwnerId = randomUUID();
  const bulkUser = await db.user.create({
    data: {
      id: bulkOwnerId,
      name: "Bulk Owner",
      email: `${bulkOwnerId}@test.local`,
      household: { create: { name: "Casa 101" } },
    },
    include: { household: true },
  });
  const bulkHouseholdId = bulkUser.household!.id;
  const foreignBulkUserId = randomUUID();
  const foreignBulk = await db.user.create({
    data: {
      id: foreignBulkUserId,
      name: "Foreign Bulk",
      email: `${foreignBulkUserId}@test.local`,
      household: { create: { name: "Casa Alheia 101" } },
    },
    include: { household: true },
  });

  try {
    const oldestDevice = await db.device.create({
      data: {
        householdId: bulkHouseholdId,
        name: "Tablet 101 Mais Antigo",
        createdAt: new Date("2025-01-01T00:00:00.000Z"),
      },
    });
    const revokedOldDevice = await db.device.create({
      data: {
        householdId: bulkHouseholdId,
        name: "Tablet 101 Revogado",
        createdAt: new Date("2025-01-01T00:00:01.000Z"),
        revokedAt: new Date(),
      },
    });
    const foreignDevice = await db.device.create({
      data: {
        householdId: foreignBulk.household!.id,
        name: "Tablet Estrangeiro",
        createdAt: new Date("2025-01-01T00:00:02.000Z"),
      },
    });
    await db.device.createMany({
      data: Array.from({ length: 100 }, (_, index) => ({
        householdId: bulkHouseholdId,
        name: `Tablet Recente ${index + 1}`,
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)),
      })),
    });

    panelAccess.mockResolvedValue({
      household: { id: bulkHouseholdId },
      user: { id: bulkOwnerId },
    });

    const withoutInclude = await (await listDevices(request("GET", undefined, "/api/devices"))).json();
    expect(withoutInclude.data).toHaveLength(100);
    expect(withoutInclude.data.some((d: { id: string }) => d.id === oldestDevice.id)).toBe(false);

    const withValidInclude = await (
      await listDevices(
        request("GET", undefined, `/api/devices?includeId=${encodeURIComponent(oldestDevice.id)}`),
      )
    ).json();
    expect(withValidInclude.data.some((d: { id: string }) => d.id === oldestDevice.id)).toBe(true);

    const withRevokedInclude = await (
      await listDevices(
        request("GET", undefined, `/api/devices?includeId=${encodeURIComponent(revokedOldDevice.id)}`),
      )
    ).json();
    expect(withRevokedInclude.data.some((d: { id: string }) => d.id === revokedOldDevice.id)).toBe(
      false,
    );

    const withForeignInclude = await (
      await listDevices(
        request("GET", undefined, `/api/devices?includeId=${encodeURIComponent(foreignDevice.id)}`),
      )
    ).json();
    expect(withForeignInclude.data.some((d: { id: string }) => d.id === foreignDevice.id)).toBe(
      false,
    );
  } finally {
    panelAccess.mockResolvedValue({ household: { id: householdId }, user: { id: userId } });
    await db.household.deleteMany({ where: { ownerId: { in: [bulkOwnerId, foreignBulkUserId] } } });
    await db.user.deleteMany({ where: { id: { in: [bulkOwnerId, foreignBulkUserId] } } });
  }
});
