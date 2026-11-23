import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import * as database from "@smartframe/database";
import {
  controlDeckHostStatusSchema,
  defaultOnlineDashboard,
  type ControlDeckHostStatus,
} from "@smartframe/contracts";
import { createWebhookKey, issuePairingCode, redeemPairingCode } from "@smartframe/frames";

vi.mock("server-only", () => ({}));
const panelAccess = vi.hoisted(() => vi.fn());
vi.mock("../apps/web/src/lib/panel-access", () => ({ panelAccess }));

import {
  GET as getBindings,
  POST as createBinding,
  PUT as updateBinding,
  DELETE as deleteBinding,
} from "../apps/web/src/app/api/control-deck/bindings/route";
import { GET as getStatus } from "../apps/web/src/app/api/control-deck/status/route";
import { POST as executeControlDeck } from "../apps/web/src/app/api/player/control-deck/execute/route";
import { GET as getPlayerConfig } from "../apps/web/src/app/api/player/config/route";
import { POST as previewWidgets } from "../apps/web/src/app/api/online-frame/widgets/route";
import { POST as createPanel, PUT as savePanel } from "../apps/web/src/app/api/panels/route";
import { publishOnlinePanel } from "../apps/web/src/lib/publish-online-panel";
import { previewWidgetSettings } from "../apps/web/src/lib/online-editor/widget-settings";

const db = database.getDatabase();
const userA = randomUUID();
const userB = randomUUID();
let householdA: string;
let householdB: string;
let deviceA: string;
let tokenA: string;
let deviceB: string;
let tokenB: string;
let panelA: string;
let revisionA: string;
let activeServer: Server | null = null;

const AGENT_TOKEN = "agent-secret-token-control-deck-0123456789abcdef";
const ORIGINAL_AGENT_URL = process.env.SMARTFRAME_CONTROL_DECK_URL;
const ORIGINAL_AGENT_TOKEN = process.env.SMARTFRAME_CONTROL_DECK_TOKEN;
const ORIGINAL_AGENT_HOUSEHOLD = process.env.SMARTFRAME_CONTROL_DECK_HOUSEHOLD_ID;

const adminReq = (url: string, method: string, body?: unknown, origin = "https://example.test") =>
  new Request(`https://example.test${url}`, {
    method,
    headers: {
      origin,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

const playerExecReq = (
  body: unknown,
  auth = `Bearer ${tokenA}`,
  query = "",
  extraHeaders: Record<string, string> = {},
) =>
  new Request(`https://example.test/api/player/control-deck/execute${query}`, {
    method: "POST",
    headers: {
      ...(auth ? { authorization: auth } : {}),
      "content-type": "application/json",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });

async function startMockAgent(
  handler: (req: IncomingMessage, res: ServerResponse, rawBody: string) => void | Promise<void>,
): Promise<string> {
  if (activeServer) {
    await new Promise<void>((resolve) => activeServer!.close(() => resolve()));
    activeServer = null;
  }
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      void Promise.resolve(handler(req, res, Buffer.concat(chunks).toString("utf8"))).catch(() => {
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  activeServer = server;
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("Endereço inválido.");
  const url = `http://127.0.0.1:${addr.port}`;
  process.env.SMARTFRAME_CONTROL_DECK_URL = url;
  process.env.SMARTFRAME_CONTROL_DECK_TOKEN = AGENT_TOKEN;
  process.env.SMARTFRAME_CONTROL_DECK_HOUSEHOLD_ID = householdA;
  return url;
}

function clearAgentEnv() {
  delete process.env.SMARTFRAME_CONTROL_DECK_URL;
  delete process.env.SMARTFRAME_CONTROL_DECK_TOKEN;
}

function sampleHostStatus(overrides: Partial<ControlDeckHostStatus> = {}): ControlDeckHostStatus {
  return controlDeckHostStatusSchema.parse({
    available: true,
    platform: "win32",
    checkedAt: new Date().toISOString(),
    capabilities: {
      shortcuts: true,
      media: true,
      volume: true,
      appVolume: true,
      brightness: false,
      mic: true,
    },
    volume: { available: true, level: 42, muted: false },
    brightness: { available: false, level: null },
    mic: {
      available: true,
      muted: true,
      pttActive: false,
      leaseId: null,
      leaseExpiresAt: null,
    },
    media: { available: true, playbackState: "playing" },
    shortcuts: [
      { shortcutId: "sc-ide-secret", label: "Abrir IDE", available: true },
      { shortcutId: "sc-missing", label: "Ausente", available: false },
    ],
    ...overrides,
  });
}

beforeAll(async () => {
  process.env.BETTER_AUTH_URL = "https://example.test";
  clearAgentEnv();
  const [uA, uB] = await Promise.all([
    db.user.create({
      data: {
        id: userA,
        name: "Casa A",
        email: `${userA}@test.local`,
        household: { create: { name: "Casa A" } },
      },
      include: { household: true },
    }),
    db.user.create({
      data: {
        id: userB,
        name: "Casa B",
        email: `${userB}@test.local`,
        household: { create: { name: "Casa B" } },
      },
      include: { household: true },
    }),
  ]);
  householdA = uA.household!.id;
  householdB = uB.household!.id;

  const pairA = await issuePairingCode(db, householdA, userA);
  const redeemedA = await redeemPairingCode(db, pairA.code, "Tablet A");
  deviceA = redeemedA.deviceId;
  tokenA = redeemedA.token;

  const pairB = await issuePairingCode(db, householdB, userB);
  const redeemedB = await redeemPairingCode(db, pairB.code, "Tablet B");
  deviceB = redeemedB.deviceId;
  tokenB = redeemedB.token;

  panelAccess.mockResolvedValue({ household: { id: householdA }, user: { id: userA } });
  const createdPanel = await (
    await createPanel(adminReq("/api/panels", "POST", { name: "Painel Deck A" }))
  ).json();
  panelA = createdPanel.id;
});

afterEach(async () => {
  vi.restoreAllMocks();
  clearAgentEnv();
  delete process.env.SMARTFRAME_CONTROL_DECK_HOUSEHOLD_ID;
  if (activeServer) {
    await new Promise<void>((resolve) => activeServer!.close(() => resolve()));
    activeServer = null;
  }
});

afterAll(async () => {
  if (ORIGINAL_AGENT_URL === undefined) delete process.env.SMARTFRAME_CONTROL_DECK_URL;
  else process.env.SMARTFRAME_CONTROL_DECK_URL = ORIGINAL_AGENT_URL;
  if (ORIGINAL_AGENT_TOKEN === undefined) delete process.env.SMARTFRAME_CONTROL_DECK_TOKEN;
  else process.env.SMARTFRAME_CONTROL_DECK_TOKEN = ORIGINAL_AGENT_TOKEN;
  if (ORIGINAL_AGENT_HOUSEHOLD === undefined) delete process.env.SMARTFRAME_CONTROL_DECK_HOUSEHOLD_ID;
  else process.env.SMARTFRAME_CONTROL_DECK_HOUSEHOLD_ID = ORIGINAL_AGENT_HOUSEHOLD;

  await db.requestLimit.deleteMany({ where: { key: { startsWith: "cd:" } } });
  await db.controlDeckBinding.deleteMany({
    where: { householdId: { in: [householdA, householdB] } },
  });
  await db.auditLog.deleteMany({
    where: { householdId: { in: [householdA, householdB] } },
  });
  await db.household.deleteMany({ where: { ownerId: { in: [userA, userB] } } });
  await db.user.deleteMany({ where: { id: { in: [userA, userB] } } });
  await db.$disconnect();
});

it("exige sessão admin e mesma origem em /api/control-deck/bindings e /api/control-deck/status", async () => {
  panelAccess.mockResolvedValueOnce(null);
  expect((await getBindings(adminReq("/api/control-deck/bindings", "GET"))).status).toBe(401);

  panelAccess.mockResolvedValueOnce(null);
  expect((await getStatus(adminReq("/api/control-deck/status", "GET"))).status).toBe(401);

  panelAccess.mockResolvedValue({ household: { id: householdA }, user: { id: userA } });
  expect(
    (
      await createBinding(
        adminReq(
          "/api/control-deck/bindings",
          "POST",
          {
            label: "Mudo",
            kind: "volume",
            action: "mute_toggle",
            target: { step: 5 },
          },
          "https://evil.test",
        ),
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await updateBinding(
        adminReq(
          "/api/control-deck/bindings",
          "PUT",
          {
            id: "missing",
            label: "Mudo",
            kind: "volume",
            action: "mute_toggle",
            target: { step: 5 },
          },
          "https://evil.test",
        ),
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await deleteBinding(
        adminReq("/api/control-deck/bindings?id=missing", "DELETE", undefined, "https://evil.test"),
      )
    ).status,
  ).toBe(403);
});

it("gerencia CRUD de vínculos com cálculo de idempotência, limite 50, AuditLog e isolamento entre casas", async () => {
  panelAccess.mockResolvedValue({ household: { id: householdA }, user: { id: userA } });

  const createVol = await createBinding(
    adminReq("/api/control-deck/bindings", "POST", {
      label: "Volume absoluto",
      kind: "volume",
      action: "set_level",
      target: { step: 5 },
    }),
  );
  expect(createVol.status).toBe(201);
  const volBinding = (await createVol.json()).binding;
  expect(volBinding.idempotent).toBe(true);

  const createShortcut = await createBinding(
    adminReq("/api/control-deck/bindings", "POST", {
      label: "Atalho IDE",
      kind: "shortcut",
      action: "launch",
      target: { shortcutId: "sc-ide-secret" },
    }),
  );
  expect(createShortcut.status).toBe(201);
  const shortcutBinding = (await createShortcut.json()).binding;
  expect(shortcutBinding.idempotent).toBe(false);

  // Atualizar de não-idempotente para idempotente recalcula no servidor.
  const updatedRes = await updateBinding(
    adminReq("/api/control-deck/bindings", "PUT", {
      id: shortcutBinding.id,
      label: "Brilho absoluto",
      kind: "brightness",
      action: "set_level",
      target: { step: 10 },
      enabled: true,
    }),
  );
  expect(updatedRes.status).toBe(200);
  expect((await updatedRes.json()).binding.idempotent).toBe(true);

  // Casa B não vê nem altera ou exclui vínculos da Casa A (IDOR).
  panelAccess.mockResolvedValue({ household: { id: householdB }, user: { id: userB } });
  const listB = await (await getBindings(adminReq("/api/control-deck/bindings", "GET"))).json();
  expect(listB.bindings).toEqual([]);

  expect(
    (
      await updateBinding(
        adminReq("/api/control-deck/bindings", "PUT", {
          id: volBinding.id,
          label: "Hack",
          kind: "volume",
          action: "set_level",
          target: { step: 5 },
        }),
      )
    ).status,
  ).toBe(404);
  expect(
    (await deleteBinding(adminReq(`/api/control-deck/bindings?id=${volBinding.id}`, "DELETE")))
      .status,
  ).toBe(404);
  expect(
    (await deleteBinding(adminReq("/api/control-deck/bindings", "DELETE", { id: volBinding.id })))
      .status,
  ).toBe(404);

  // Excluir em Casa A via ?id= e via JSON body funciona e grava AuditLog.
  panelAccess.mockResolvedValue({ household: { id: householdA }, user: { id: userA } });
  expect(
    (await deleteBinding(adminReq(`/api/control-deck/bindings?id=${volBinding.id}`, "DELETE")))
      .status,
  ).toBe(200);
  expect(
    (
      await deleteBinding(
        adminReq("/api/control-deck/bindings", "DELETE", { id: shortcutBinding.id }),
      )
    ).status,
  ).toBe(200);

  const logs = await db.auditLog.findMany({
    where: { householdId: householdA },
    select: { action: true },
  });
  const actions = logs.map((entry) => entry.action);
  expect(actions).toContain("control_deck.binding.created");
  expect(actions).toContain("control_deck.binding.updated");
  expect(actions).toContain("control_deck.binding.deleted");

  // Limite máximo de 50 vínculos por residência.
  panelAccess.mockResolvedValue({ household: { id: householdB }, user: { id: userB } });
  const extraIds: string[] = [];
  for (let i = 0; i < 50; i++) {
    const res = await createBinding(
      adminReq("/api/control-deck/bindings", "POST", {
        label: `Bind ${i}`,
        kind: "media",
        action: "play_pause",
        target: {},
      }),
    );
    expect(res.status).toBe(201);
    extraIds.push((await res.json()).binding.id);
  }
  const overLimit = await createBinding(
    adminReq("/api/control-deck/bindings", "POST", {
      label: "Bind 51",
      kind: "media",
      action: "play_pause",
      target: {},
    }),
  );
  expect(overLimit.status).toBe(409);

  await db.controlDeckBinding.deleteMany({ where: { id: { in: extraIds }, householdId: householdB } });
});

it("consulta status real do agente em /api/control-deck/status e nunca vaza segredos ou valores fictícios", async () => {
  panelAccess.mockResolvedValue({ household: { id: householdA }, user: { id: userA } });

  // Sem configuração
  const unconfigured = await getStatus(adminReq("/api/control-deck/status", "GET"));
  expect(unconfigured.status).toBe(200);
  const unconfiguredJson = await unconfigured.json();
  expect(unconfiguredJson.configured).toBe(false);
  expect(unconfiguredJson.reachable).toBe(false);
  expect(unconfiguredJson.status.available).toBe(false);
  expect(unconfiguredJson.status.volume).toEqual({ available: false, level: null, muted: null });
  expect(unconfiguredJson.status.brightness).toEqual({ available: false, level: null });

  // Com agente mock em 127.0.0.1 autorizado apenas para householdA
  let agentCalls = 0;
  let seenAuth = "";
  await startMockAgent((req, res) => {
    agentCalls += 1;
    seenAuth = req.headers.authorization ?? "";
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(sampleHostStatus()));
  });

  const online = await getStatus(adminReq("/api/control-deck/status", "GET"));
  expect(online.status).toBe(200);
  expect(agentCalls).toBe(1);
  expect(seenAuth).toBe(`Bearer ${AGENT_TOKEN}`);
  const onlineJson = await online.json();
  expect(onlineJson.configured).toBe(true);
  expect(onlineJson.reachable).toBe(true);
  expect(onlineJson.status.volume).toEqual({ available: true, level: 42, muted: false });
  expect(JSON.stringify(onlineJson)).not.toContain(AGENT_TOKEN);

  // Outra residência (householdB) não pode consultar status nem atalhos do host de householdA
  panelAccess.mockResolvedValue({ household: { id: householdB }, user: { id: userB } });
  const otherHouseholdRes = await getStatus(adminReq("/api/control-deck/status", "GET"));
  expect(otherHouseholdRes.status).toBe(200);
  expect(agentCalls).toBe(1);
  const otherHouseholdJson = await otherHouseholdRes.json();
  expect(otherHouseholdJson.configured).toBe(false);
  expect(otherHouseholdJson.reachable).toBe(false);
  expect(otherHouseholdJson.status.available).toBe(false);
  expect(otherHouseholdJson.status.volume).toEqual({ available: false, level: null, muted: null });
  expect(otherHouseholdJson.status.shortcuts).toEqual([]);

  // Sem SMARTFRAME_CONTROL_DECK_HOUSEHOLD_ID configurado, nega mesmo com URL/TOKEN definidos
  delete process.env.SMARTFRAME_CONTROL_DECK_HOUSEHOLD_ID;
  panelAccess.mockResolvedValue({ household: { id: householdA }, user: { id: userA } });
  const unsetHouseholdRes = await getStatus(adminReq("/api/control-deck/status", "GET"));
  expect(unsetHouseholdRes.status).toBe(200);
  expect(agentCalls).toBe(1);
  const unsetHouseholdJson = await unsetHouseholdRes.json();
  expect(unsetHouseholdJson.configured).toBe(false);
  expect(unsetHouseholdJson.reachable).toBe(false);
  expect(unsetHouseholdJson.status.available).toBe(false);
  expect(unsetHouseholdJson.status.shortcuts).toEqual([]);
});

it("GET /api/player/config e preview projetam somente tiles publicados sem vazar target, shortcutId, appName ou token", async () => {
  panelAccess.mockResolvedValue({ household: { id: householdA }, user: { id: userA } });

  const bShortcut = (
    await (
      await createBinding(
        adminReq("/api/control-deck/bindings", "POST", {
          label: "Abrir Editor",
          kind: "shortcut",
          action: "launch",
          target: { shortcutId: "sc-ide-secret" },
        }),
      )
    ).json()
  ).binding;

  const bApp = (
    await (
      await createBinding(
        adminReq("/api/control-deck/bindings", "POST", {
          label: "Spotify",
          kind: "app_volume",
          action: "set_level",
          target: { appName: "SecretSpotifyApp" },
        }),
      )
    ).json()
  ).binding;

  const bMic = (
    await (
      await createBinding(
        adminReq("/api/control-deck/bindings", "POST", {
          label: "Microfone PTT",
          kind: "mic_ptt",
          action: "hold_unmute",
          target: { leaseSeconds: 12 },
        }),
      )
    ).json()
  ).binding;

  const bBrightness = (
    await (
      await createBinding(
        adminReq("/api/control-deck/bindings", "POST", {
          label: "Brilho",
          kind: "brightness",
          action: "step_up",
          target: { step: 15 },
        }),
      )
    ).json()
  ).binding;

  const bUnpublished = (
    await (
      await createBinding(
        adminReq("/api/control-deck/bindings", "POST", {
          label: "Nao Publicado",
          kind: "media",
          action: "stop",
          target: {},
        }),
      )
    ).json()
  ).binding;

  const configPayload = {
    ...defaultOnlineDashboard,
    widgets: {
      ...defaultOnlineDashboard.widgets,
      weather: { ...defaultOnlineDashboard.widgets.weather, enabled: false },
      currencies: { ...defaultOnlineDashboard.widgets.currencies, enabled: false },
      controlDeck: {
        enabled: false,
        title: "Mesa",
        columns: 3,
        tiles: [
          { id: "t-sc", bindingId: bShortcut.id, label: "IDE", icon: "terminal" },
          { id: "t-app", bindingId: bApp.id, label: "Música", icon: "app" },
          { id: "t-mic", bindingId: bMic.id, label: "Falar", icon: "mic" },
          { id: "t-bri", bindingId: bBrightness.id, label: "Brilho+", icon: "sun" },
        ],
      },
    },
    pages: [
      { id: "main", title: "Principal", enabledWidgets: ["photos", "clock"] },
      { id: "deck", title: "Deck", enabledWidgets: ["controlDeck"] },
    ],
  };

  const panelState = await (
    await savePanel(
      adminReq("/api/panels", "PUT", {
        id: panelA,
        expectedRevision: 1,
        config: configPayload,
      }),
    )
  ).json();
  revisionA = await publishOnlinePanel(db, {
    householdId: householdA,
    deviceId: deviceA,
    panelId: panelA,
    expectedRevision: panelState.draftRevision,
    activate: true,
  });

  // Agente offline -> sem dados fictícios
  clearAgentEnv();
  const offlineRes = await getPlayerConfig(
    new Request("https://example.test/api/player/config", {
      headers: { authorization: `Bearer ${tokenA}` },
    }),
  );
  expect(offlineRes.status).toBe(200);
  const offlineJson = await offlineRes.json();
  const offlineDeck = offlineJson.widgetData.controlDeck;
  expect(offlineDeck.available).toBe(false);
  expect(offlineDeck.hostStatus.volume).toEqual({ available: false, level: null, muted: null });
  expect(offlineDeck.bindings[bShortcut.id]).toMatchObject({
    available: false,
    level: null,
    muted: null,
    leaseSeconds: null,
  });
  expect(offlineDeck.bindings[bMic.id]).toMatchObject({
    available: false,
    level: null,
    muted: null,
    leaseSeconds: 12,
  });
  expect(offlineDeck.bindings[bUnpublished.id]).toBeUndefined();

  // Agente online -> projeta capacidades reais e nunca vaza segredos ou leaseId
  await startMockAgent((_req, res) => {
    const status = sampleHostStatus();
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        ...status,
        mic: { ...status.mic, pttActive: true, leaseId: "lease-secret-should-not-leak" },
      }),
    );
  });

  const onlineRes = await getPlayerConfig(
    new Request("https://example.test/api/player/config", {
      headers: { authorization: `Bearer ${tokenA}` },
    }),
  );
  expect(onlineRes.status).toBe(200);
  const onlineJson = await onlineRes.json();
  const serialized = JSON.stringify(onlineJson);
  const serializedDeck = JSON.stringify({
    widget: onlineJson.widgets.controlDeck,
    data: onlineJson.widgetData.controlDeck,
  });
  expect(serialized).not.toContain("sc-ide-secret");
  expect(serialized).not.toContain("SecretSpotifyApp");
  expect(serialized).not.toContain("lease-secret-should-not-leak");
  expect(serialized).not.toContain(AGENT_TOKEN);
  expect(serialized).not.toContain('"shortcutId"');
  expect(serialized).not.toContain('"appName"');
  expect(serializedDeck).not.toContain('"leaseId"');
  expect(serializedDeck).not.toContain('"target"');

  const onlineDeck = onlineJson.widgetData.controlDeck;
  expect(onlineDeck.available).toBe(true);
  expect(onlineDeck.bindings[bShortcut.id].available).toBe(true);
  expect(onlineDeck.bindings[bApp.id].available).toBe(true);
  expect(onlineDeck.bindings[bMic.id]).toMatchObject({
    available: true,
    muted: true,
    leaseSeconds: 12,
  });
  expect(onlineDeck.bindings[bBrightness.id]).toMatchObject({
    available: false,
    level: null,
  });
  expect(onlineDeck.bindings[bUnpublished.id]).toBeUndefined();

  // Preview de widgets no editor também inclui controlDeck sanitizado
  const previewRes = await previewWidgets(
    adminReq("/api/online-frame/widgets", "POST", {
      widgets: previewWidgetSettings(onlineJson),
    }),
  );
  expect(previewRes.status).toBe(200);
  const previewJson = await previewRes.json();
  expect(previewJson.controlDeck.available).toBe(true);
  expect(JSON.stringify(previewJson)).not.toContain("SecretSpotifyApp");
  expect(JSON.stringify(previewJson)).not.toContain("sc-ide-secret");

  // A registered executable remains usable even when the host has no audio or brightness controls.
  await startMockAgent((_req, res) => {
    const status = sampleHostStatus({
      available: false,
      capabilities: {
        shortcuts: true,
        media: false,
        volume: false,
        appVolume: false,
        brightness: false,
        mic: false,
      },
      volume: { available: false, level: null, muted: null },
      brightness: { available: false, level: null },
      mic: {
        available: false,
        muted: null,
        pttActive: false,
        leaseId: null,
        leaseExpiresAt: null,
      },
      media: { available: false, playbackState: "unknown" },
      shortcuts: [{ shortcutId: "sc-ide-secret", label: "Abrir IDE", available: true }],
    });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(status));
  });
  const shortcutOnlyRes = await getPlayerConfig(
    new Request("https://example.test/api/player/config", {
      headers: { authorization: `Bearer ${tokenA}` },
    }),
  );
  const shortcutOnlyDeck = (await shortcutOnlyRes.json()).widgetData.controlDeck;
  expect(shortcutOnlyDeck.available).toBe(false);
  expect(shortcutOnlyDeck.bindings[bShortcut.id].available).toBe(true);
  expect(shortcutOnlyDeck.bindings[bApp.id].available).toBe(false);
});

it("POST /api/player/control-deck/execute valida auth, revisão, publicação, compatibilidade e trata offline/timeout/queda sem retry cego", async () => {
  panelAccess.mockResolvedValue({ household: { id: householdA }, user: { id: userA } });
  process.env.SMARTFRAME_CONTROL_DECK_HOUSEHOLD_ID = householdA;

  const bVolume = (
    await (
      await createBinding(
        adminReq("/api/control-deck/bindings", "POST", {
          label: "Volume Set",
          kind: "volume",
          action: "set_level",
          target: { step: 5 },
        }),
      )
    ).json()
  ).binding;

  const bMedia = (
    await (
      await createBinding(
        adminReq("/api/control-deck/bindings", "POST", {
          label: "Play Pause",
          kind: "media",
          action: "play_pause",
          target: {},
        }),
      )
    ).json()
  ).binding;

  const bMic = (
    await (
      await createBinding(
        adminReq("/api/control-deck/bindings", "POST", {
          label: "Mic PTT",
          kind: "mic_ptt",
          action: "hold_unmute",
          target: { leaseSeconds: 8 },
        }),
      )
    ).json()
  ).binding;

  const bNotInPanel = (
    await (
      await createBinding(
        adminReq("/api/control-deck/bindings", "POST", {
          label: "Fora do Painel",
          kind: "shortcut",
          action: "launch",
          target: { shortcutId: "sc-ide-secret" },
        }),
      )
    ).json()
  ).binding;

  // Vínculo de outra casa (Casa B) colocado artificialmente em tile não pode ser executado por Casa A.
  panelAccess.mockResolvedValue({ household: { id: householdB }, user: { id: userB } });
  const bOtherHouse = (
    await (
      await createBinding(
        adminReq("/api/control-deck/bindings", "POST", {
          label: "Casa B",
          kind: "media",
          action: "stop",
          target: {},
        }),
      )
    ).json()
  ).binding;

  panelAccess.mockResolvedValue({ household: { id: householdA }, user: { id: userA } });
  const currentPanel = await db.layout.findUniqueOrThrow({ where: { id: panelA } });
  const saved = await (
    await savePanel(
      adminReq("/api/panels", "PUT", {
        id: panelA,
        expectedRevision: currentPanel.draftRevision,
        config: {
          ...defaultOnlineDashboard,
          widgets: {
            ...defaultOnlineDashboard.widgets,
            weather: { ...defaultOnlineDashboard.widgets.weather, enabled: false },
            currencies: { ...defaultOnlineDashboard.widgets.currencies, enabled: false },
            controlDeck: {
              enabled: true,
              title: "Control Deck",
              columns: 3,
              tiles: [
                { id: "t-vol", bindingId: bVolume.id, label: "Vol", icon: "volume" },
                { id: "t-med", bindingId: bMedia.id, label: "Play", icon: "play" },
                { id: "t-mic", bindingId: bMic.id, label: "PTT", icon: "mic" },
                { id: "t-other", bindingId: bOtherHouse.id, label: "Outro", icon: "bolt" },
              ],
            },
          },
        },
      }),
    )
  ).json();

  revisionA = await publishOnlinePanel(db, {
    householdId: householdA,
    deviceId: deviceA,
    panelId: panelA,
    expectedRevision: saved.draftRevision,
    activate: true,
  });

  // 1. Rejeita cookie admin (sem Bearer) e chave sf_wh_ (401)
  expect(
    (
      await executeControlDeck(
        playerExecReq(
          { executionId: "exec-unauth-1", revision: revisionA, bindingId: bVolume.id },
          "",
          "",
          { cookie: "better-auth.session_token=fake-admin-cookie" },
        ),
      )
    ).status,
  ).toBe(401);

  const whKey = await createWebhookKey(db, householdA, userA, {
    name: "WH Test",
    permissions: ["push", "notify", "goto", "refresh"],
  });
  expect(
    (
      await executeControlDeck(
        playerExecReq(
          { executionId: "exec-whkey-1", revision: revisionA, bindingId: bVolume.id },
          `Bearer ${whKey.secret}`,
        ),
      )
    ).status,
  ).toBe(401);

  // 2. Rejeita ?deviceId divergente (403)
  expect(
    (
      await executeControlDeck(
        playerExecReq(
          {
            executionId: "exec-dev-mismatch",
            revision: revisionA,
            bindingId: bVolume.id,
            command: "set_level",
            value: 50,
          },
          `Bearer ${tokenA}`,
          `?deviceId=${deviceB}`,
        ),
      )
    ).status,
  ).toBe(403);

  // 3. Rejeita revisão antiga (409)
  expect(
    (
      await executeControlDeck(
        playerExecReq({
          executionId: "exec-old-rev",
          revision: "online:old-revision-id",
          bindingId: bVolume.id,
          command: "set_level",
          value: 50,
        }),
      )
    ).status,
  ).toBe(409);

  // 4. Rejeita bindingId não publicado no painel ativo (403)
  expect(
    (
      await executeControlDeck(
        playerExecReq({
          executionId: "exec-unpub-1",
          revision: revisionA,
          bindingId: bNotInPanel.id,
          command: "trigger",
        }),
      )
    ).status,
  ).toBe(403);

  // 5. Rejeita bindingId de outra residência mesmo se inserido em tile (404)
  expect(
    (
      await executeControlDeck(
        playerExecReq({
          executionId: "exec-idor-1",
          revision: revisionA,
          bindingId: bOtherHouse.id,
          command: "trigger",
        }),
      )
    ).status,
  ).toBe(404);

  // 6. Rejeita comandos/parâmetros incompatíveis (400)
  expect(
    (
      await executeControlDeck(
        playerExecReq({
          executionId: "exec-bad-1",
          revision: revisionA,
          bindingId: bVolume.id,
          command: "trigger",
        }),
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await executeControlDeck(
        playerExecReq({
          executionId: "exec-bad-2",
          revision: revisionA,
          bindingId: bMedia.id,
          command: "set_level",
          value: 40,
        }),
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await executeControlDeck(
        playerExecReq({
          executionId: "exec-bad-3",
          revision: revisionA,
          bindingId: bMic.id,
          command: "ptt_renew",
        }),
      )
    ).status,
  ).toBe(400);

  // 7. Agente offline/não configurado retorna HTTP 200 status: "unavailable" sem dados fictícios
  clearAgentEnv();
  const offlineExec = await executeControlDeck(
    playerExecReq({
      executionId: "exec-off-1",
      revision: revisionA,
      bindingId: bVolume.id,
      command: "set_level",
      value: 55,
    }),
  );
  expect(offlineExec.status).toBe(200);
  expect(await offlineExec.json()).toMatchObject({
    status: "unavailable",
    bindingId: bVolume.id,
    executionId: "exec-off-1",
    idempotent: true,
  });

  // 8. Execução com sucesso contra servidor HTTP mock em 127.0.0.1
  const receivedPayloads: Array<Record<string, unknown>> = [];
  await startMockAgent((req, res, rawBody) => {
    expect(req.headers.authorization).toBe(`Bearer ${AGENT_TOKEN}`);
    const body = JSON.parse(rawBody) as Record<string, unknown>;
    receivedPayloads.push(body);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        status: "ok",
        bindingId: body.bindingId,
        executionId: body.executionId,
        idempotent: body.idempotent,
        message: "C:\\Secret\\path Executado",
        ...(body.command === "set_level" ? { state: { level: body.value, muted: false } } : {}),
        ...(body.command === "ptt_acquire"
          ? {
              state: { muted: false },
              lease: {
                leaseId: "lease-xyz-1",
                expiresAt: new Date(Date.now() + 8000).toISOString(),
                leaseSeconds: 8,
              },
            }
          : {}),
      }),
    );
  });

  const okVol = await executeControlDeck(
    playerExecReq({
      executionId: "exec-ok-vol-1",
      revision: revisionA,
      bindingId: bVolume.id,
      command: "set_level",
      value: 65,
    }),
  );
  expect(okVol.status).toBe(200);
  const okVolJson = await okVol.json();
  expect(okVolJson).toMatchObject({
    status: "ok",
    idempotent: true,
    state: { level: 65, muted: false },
  });
  expect(JSON.stringify(okVolJson)).not.toContain("Secret");
  expect(receivedPayloads.at(-1)).toMatchObject({
    deviceId: deviceA,
    bindingId: bVolume.id,
    kind: "volume",
    action: "set_level",
    target: { step: 5 },
    command: "set_level",
    value: 65,
    idempotent: true,
  });

  const okPtt = await executeControlDeck(
    playerExecReq({
      executionId: "exec-ok-ptt-1",
      leaseRequestId: "exec-ok-ptt-1",
      revision: revisionA,
      bindingId: bMic.id,
      command: "ptt_acquire",
      leaseSeconds: 8,
    }),
  );
  expect(okPtt.status).toBe(200);
  expect(await okPtt.json()).toMatchObject({
    status: "ok",
    idempotent: true,
    lease: { leaseId: "lease-xyz-1", leaseSeconds: 8 },
  });
  expect(receivedPayloads.at(-1)).toMatchObject({
    command: "ptt_acquire",
    executionId: "exec-ok-ptt-1",
    leaseRequestId: "exec-ok-ptt-1",
  });

  // 9. Queda pós-envio em comando NÃO idempotente -> HTTP 504 { status: "unknown", idempotent: false } e ZERO retries!
  let dropCount = 0;
  await startMockAgent((req) => {
    dropCount += 1;
    req.socket.destroy();
  });
  const droppedNonIdemp = await executeControlDeck(
    playerExecReq({
      executionId: "exec-drop-nonidemp",
      revision: revisionA,
      bindingId: bMedia.id,
      command: "trigger",
    }),
  );
  expect(droppedNonIdemp.status).toBe(504);
  expect(await droppedNonIdemp.json()).toMatchObject({
    status: "unknown",
    bindingId: bMedia.id,
    executionId: "exec-drop-nonidemp",
    idempotent: false,
  });
  expect(dropCount).toBe(1);

  // 10. Queda pós-envio em comando IDEMPOTENTE -> HTTP 503 { status: "error", idempotent: true } e ZERO retries!
  let dropIdempCount = 0;
  await startMockAgent((req) => {
    dropIdempCount += 1;
    req.socket.destroy();
  });
  const droppedIdemp = await executeControlDeck(
    playerExecReq({
      executionId: "exec-drop-idemp",
      revision: revisionA,
      bindingId: bVolume.id,
      command: "set_level",
      value: 20,
    }),
  );
  expect(droppedIdemp.status).toBe(503);
  expect(await droppedIdemp.json()).toMatchObject({
    status: "error",
    bindingId: bVolume.id,
    executionId: "exec-drop-idemp",
    idempotent: true,
  });
  expect(dropIdempCount).toBe(1);

  // 11. Timeout pós-envio em comando NÃO idempotente -> HTTP 504 { status: "unknown", idempotent: false } e ZERO retries!
  let slowCount = 0;
  const timersToClear: ReturnType<typeof setTimeout>[] = [];
  await startMockAgent((_req, res) => {
    slowCount += 1;
    const t = setTimeout(() => {
      if (!res.writableEnded) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end("{}");
      }
    }, 400);
    timersToClear.push(t);
  });
  const origTimeout = AbortSignal.timeout.bind(AbortSignal);
  vi.spyOn(AbortSignal, "timeout").mockImplementation(() => origTimeout(60));
  const timedOutNonIdemp = await executeControlDeck(
    playerExecReq({
      executionId: "exec-timeout-nonidemp",
      revision: revisionA,
      bindingId: bMedia.id,
      command: "trigger",
    }),
  );
  for (const t of timersToClear) clearTimeout(t);
  expect(timedOutNonIdemp.status).toBe(504);
  expect(await timedOutNonIdemp.json()).toMatchObject({
    status: "unknown",
    bindingId: bMedia.id,
    executionId: "exec-timeout-nonidemp",
    idempotent: false,
  });
  expect(slowCount).toBe(1);

  // 11b. Resposta HTTP 500 / JSON inválida do agente em comando NÃO idempotente -> HTTP 504 { status: "unknown", idempotent: false } e ZERO retries!
  let badHttpCount = 0;
  await startMockAgent((_req, res) => {
    badHttpCount += 1;
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "boom" }));
  });
  const badHttpRes = await executeControlDeck(
    playerExecReq({
      executionId: "exec-badhttp-nonidemp",
      revision: revisionA,
      bindingId: bMedia.id,
      command: "trigger",
    }),
  );
  expect(badHttpRes.status).toBe(504);
  expect(await badHttpRes.json()).toMatchObject({
    status: "unknown",
    bindingId: bMedia.id,
    executionId: "exec-badhttp-nonidemp",
    idempotent: false,
  });
  expect(badHttpCount).toBe(1);

  // 12. Dispositivo sem publicação ativa -> 409
  const pairUnpublished = await issuePairingCode(db, householdA, userA);
  const redeemedUnpub = await redeemPairingCode(db, pairUnpublished.code, "Sem Painel");
  expect(
    (
      await executeControlDeck(
        playerExecReq(
          {
            executionId: "exec-no-panel-1",
            revision: revisionA,
            bindingId: bVolume.id,
            command: "set_level",
            value: 30,
          },
          `Bearer ${redeemedUnpub.token}`,
        ),
      )
    ).status,
  ).toBe(409);

  // 13. Rate limit 60/min por dispositivo -> 429
  clearAgentEnv();
  await db.requestLimit.upsert({
    where: { key: `cd:dev:${deviceA}` },
    create: { key: `cd:dev:${deviceA}`, windowStart: new Date(), count: 60 },
    update: { windowStart: new Date(), count: 60 },
  });
  const limited = await executeControlDeck(
    playerExecReq({
      executionId: "exec-ratelimit-61",
      revision: revisionA,
      bindingId: bVolume.id,
      command: "set_level",
      value: 10,
    }),
  );
  expect(limited.status).toBe(429);

  // 13b. ptt_renew usa cota separada (120/min) e ptt_release nunca é bloqueado por rate limit.
  await startMockAgent((req, res, rawBody) => {
    if (req.method !== "POST" || req.url !== "/execute") {
      res.writeHead(404);
      res.end();
      return;
    }
    const reqJson = JSON.parse(rawBody);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        status: "ok",
        bindingId: reqJson.bindingId,
        executionId: reqJson.executionId,
        idempotent: true,
        message: "OK",
        state: { muted: reqJson.command !== "ptt_renew" },
      }),
    );
  });
  const relWhenLimited = await executeControlDeck(
    playerExecReq({
      executionId: "exec-ptt-rel-limit",
      revision: revisionA,
      bindingId: bMic.id,
      command: "ptt_release",
      leaseId: "lease-xyz-1",
    }),
  );
  expect(relWhenLimited.status).toBe(200);
  clearAgentEnv();

  // 14. Vínculo com enabled=false: omitido de GET /api/player/config e 404 em /execute
  panelAccess.mockResolvedValue({ household: { id: householdA }, user: { id: userA } });
  await updateBinding(
    adminReq("/api/control-deck/bindings", "PUT", {
      id: bMedia.id,
      label: "Play Pause",
      kind: "media",
      action: "play_pause",
      target: {},
      enabled: false,
    }),
  );
  const cfgDisabledBinding = await (
    await getPlayerConfig(
      new Request("https://example.test/api/player/config", {
        headers: { authorization: `Bearer ${tokenA}` },
      }),
    )
  ).json();
  expect(cfgDisabledBinding.widgetData.controlDeck.bindings[bMedia.id]).toBeUndefined();

  await db.requestLimit.deleteMany({ where: { key: { startsWith: "cd:" } } });
  expect(
    (
      await executeControlDeck(
        playerExecReq({
          executionId: "exec-disabled-binding",
          revision: revisionA,
          bindingId: bMedia.id,
          command: "trigger",
        }),
      )
    ).status,
  ).toBe(404);

  // 15. Dispositivo da Casa B com painel publicado não executa usando revisionA da Casa A -> 409
  panelAccess.mockResolvedValue({ household: { id: householdB }, user: { id: userB } });
  const panelBCreated = await (
    await createPanel(adminReq("/api/panels", "POST", { name: "Painel B" }))
  ).json();
  const panelBState = await (
    await savePanel(
      adminReq("/api/panels", "PUT", {
        id: panelBCreated.id,
        expectedRevision: 1,
        config: {
          ...defaultOnlineDashboard,
          widgets: {
            ...defaultOnlineDashboard.widgets,
            weather: { ...defaultOnlineDashboard.widgets.weather, enabled: false },
            currencies: { ...defaultOnlineDashboard.widgets.currencies, enabled: false },
          },
        },
      }),
    )
  ).json();
  await publishOnlinePanel(db, {
    householdId: householdB,
    deviceId: deviceB,
    panelId: panelBCreated.id,
    expectedRevision: panelBState.draftRevision,
    activate: true,
  });
  expect(
    (
      await executeControlDeck(
        playerExecReq(
          {
            executionId: "exec-cross-house-b",
            revision: revisionA,
            bindingId: bVolume.id,
            command: "set_level",
            value: 15,
          },
          `Bearer ${tokenB}`,
        ),
      )
    ).status,
  ).toBe(409);

  // 16. Redirect 302 do agente não é seguido e vira 504/503 seguro
  let redirectHits = 0;
  await startMockAgent((_req, res) => {
    redirectHits += 1;
    res.writeHead(302, { location: "http://127.0.0.1:9/evil" });
    res.end();
  });
  const redirRes = await executeControlDeck(
    playerExecReq({
      executionId: "exec-redirect-302",
      revision: revisionA,
      bindingId: bVolume.id,
      command: "set_level",
      value: 20,
    }),
  );
  expect([503, 504]).toContain(redirRes.status);
  expect(redirectHits).toBe(1);

  // A alteração do comando após a publicação não deve reaproveitar o tile antigo.
  await db.controlDeckBinding.update({
    where: { id: bVolume.id },
    data: { action: "set_mute", target: {} },
  });
  const changedBindingRes = await executeControlDeck(
    playerExecReq({
      executionId: "exec-changed-binding-action",
      revision: revisionA,
      bindingId: bVolume.id,
      command: "set_level",
      value: 40,
    }),
  );
  expect(changedBindingRes.status).toBe(409);
  await db.controlDeckBinding.update({
    where: { id: bVolume.id },
    data: { action: "set_level", target: { step: 5 } },
  });

  // 17. Widget desabilitado no painel publicado mesmo com tile -> 403
  panelAccess.mockResolvedValue({ household: { id: householdA }, user: { id: userA } });
  const panelBeforeDisable = await db.layout.findUniqueOrThrow({ where: { id: panelA } });
  const savedDisabled = await (
    await savePanel(
      adminReq("/api/panels", "PUT", {
        id: panelA,
        expectedRevision: panelBeforeDisable.draftRevision,
        config: {
          ...defaultOnlineDashboard,
          widgets: {
            ...defaultOnlineDashboard.widgets,
            weather: { ...defaultOnlineDashboard.widgets.weather, enabled: false },
            currencies: { ...defaultOnlineDashboard.widgets.currencies, enabled: false },
            controlDeck: {
              enabled: false,
              title: "Control Deck",
              columns: 3,
              tiles: [{ id: "t-vol", bindingId: bVolume.id, label: "Vol", icon: "volume" }],
            },
          },
          pages: [{ id: "main", title: "Principal", enabledWidgets: ["photos"] }],
        },
      }),
    )
  ).json();
  const revDisabled = await publishOnlinePanel(db, {
    householdId: householdA,
    deviceId: deviceA,
    panelId: panelA,
    expectedRevision: savedDisabled.draftRevision,
    activate: true,
  });
  expect(
    (
      await executeControlDeck(
        playerExecReq({
          executionId: "exec-widget-disabled",
          revision: revDisabled,
          bindingId: bVolume.id,
          command: "set_level",
          value: 25,
        }),
      )
    ).status,
  ).toBe(403);

  const execLogs = await db.auditLog.findMany({
    where: { householdId: householdA, action: "control_deck.executed" },
  });
  expect(execLogs.length).toBeGreaterThanOrEqual(5);
});
