import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import * as database from "@smartframe/database";
import { defaultOnlineDashboard } from "@smartframe/contracts";
import { issuePairingCode, redeemPairingCode } from "@smartframe/frames";

vi.mock("server-only", () => ({}));
const panelAccess = vi.hoisted(() => vi.fn());
vi.mock("../apps/web/src/lib/panel-access", () => ({ panelAccess }));

import {
  GET as listKeys,
  POST as createKey,
  DELETE as deleteKey,
} from "../apps/web/src/app/api/webhooks/keys/route";
import { POST as postWebhookTest } from "../apps/web/src/app/api/webhooks/test/route";
import { POST as postPush } from "../apps/web/src/app/api/push/[key]/route";
import { POST as postNotify } from "../apps/web/src/app/api/notify/route";
import { POST as postGoto } from "../apps/web/src/app/api/goto/[page]/route";
import { POST as postRefresh } from "../apps/web/src/app/api/refresh/route";
import { POST as postDismissNotification } from "../apps/web/src/app/api/player/notifications/dismiss/route";
import { GET as getConfig } from "../apps/web/src/app/api/player/config/route";
import { POST as switchPlayerPanel } from "../apps/web/src/app/api/player/panels/route";
import { POST as createPanel, PUT as savePanel } from "../apps/web/src/app/api/panels/route";
import { publishOnlinePanel } from "../apps/web/src/lib/publish-online-panel";

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

const adminReq = (url: string, method: string, body?: unknown, origin = "https://example.test") =>
  new Request(`https://example.test${url}`, {
    method,
    headers: {
      origin,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

beforeAll(async () => {
  process.env.BETTER_AUTH_URL = "https://example.test";
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

  // Criar e publicar painel multipágina com regras para Casa A e Casa B.
  panelAccess.mockResolvedValue({ household: { id: householdA }, user: { id: userA } });
  const createdA = await (
    await createPanel(adminReq("/api/panels", "POST", { name: "Painel A" }))
  ).json();
  panelA = createdA.id;
  await savePanel(
    adminReq("/api/panels", "PUT", {
      id: panelA,
      expectedRevision: 1,
      config: {
        ...defaultOnlineDashboard,
        widgets: {
          ...defaultOnlineDashboard.widgets,
          weather: { ...defaultOnlineDashboard.widgets.weather, enabled: false },
          currencies: { ...defaultOnlineDashboard.widgets.currencies, enabled: false },
          devMonitor: {
            ...defaultOnlineDashboard.widgets.devMonitor,
            enabled: true,
            showServerMetrics: true,
            items: [
              {
                id: "item-ci",
                name: "CI Principal",
                category: "ci",
                status: "idle",
                detail: "Aguardando",
                pushKey: "ci-main",
              },
            ],
          },
        },
        pages: [
          { id: "home", title: "Início", enabledWidgets: ["photos", "clock"] },
          { id: "alerts", title: "Alertas", enabledWidgets: ["devMonitor"] },
        ],
        rules: [
          {
            id: "rule-ci-fail",
            name: "CI falhou",
            enabled: true,
            trigger: { type: "push_event", feedKey: "ci-main", status: "failing" },
            action: { type: "goto_page", pageId: "alerts", durationSeconds: 90 },
          },
          {
            id: "rule-ci-healthy",
            name: "CI saudável",
            enabled: true,
            trigger: { type: "push_event", feedKey: "ci-main", status: "healthy" },
            action: { type: "goto_page", pageId: "home", durationSeconds: 90 },
          },
          {
            id: "rule-alert-toast",
            name: "Escalonar alerta",
            enabled: true,
            trigger: { type: "notify_event", minSeverity: "alert" },
            action: {
              type: "show_notification",
              title: "Regra acionada",
              message: "Verificar serviço imediatamente",
              severity: "warning",
              durationSeconds: 12,
            },
          },
        ],
      },
    }),
  );
  await publishOnlinePanel(db, {
    householdId: householdA,
    deviceId: deviceA,
    panelId: panelA,
    expectedRevision: 2,
    activate: true,
  });

  panelAccess.mockResolvedValue({ household: { id: householdB }, user: { id: userB } });
  const createdB = await (
    await createPanel(adminReq("/api/panels", "POST", { name: "Painel B" }))
  ).json();
  await savePanel(
    adminReq("/api/panels", "PUT", {
      id: createdB.id,
      expectedRevision: 1,
      config: {
        ...defaultOnlineDashboard,
        widgets: {
          ...defaultOnlineDashboard.widgets,
          weather: { ...defaultOnlineDashboard.widgets.weather, enabled: false },
          currencies: { ...defaultOnlineDashboard.widgets.currencies, enabled: false },
          devMonitor: {
            ...defaultOnlineDashboard.widgets.devMonitor,
            enabled: true,
            showServerMetrics: false,
          },
        },
        pages: [{ id: "home-b", title: "Casa B", enabledWidgets: ["devMonitor"] }],
      },
    }),
  );
  await publishOnlinePanel(db, {
    householdId: householdB,
    deviceId: deviceB,
    panelId: createdB.id,
    expectedRevision: 2,
    activate: true,
  });
});

afterAll(async () => {
  await db.widgetSnapshot.deleteMany({
    where: {
      OR: [
        { key: { startsWith: `push:${householdA}:` } },
        { key: { startsWith: `push:${householdB}:` } },
      ],
    },
  });
  await db.requestLimit.deleteMany({ where: { key: { startsWith: "wh:" } } });
  await db.household.deleteMany({ where: { ownerId: { in: [userA, userB] } } });
  await db.user.deleteMany({ where: { id: { in: [userA, userB] } } });
  await db.$disconnect();
});

it("gerencia chaves de webhook com autenticação admin, origem e isolamento entre casas", async () => {
  panelAccess.mockResolvedValueOnce(null);
  expect((await listKeys(adminReq("/api/webhooks/keys", "GET"))).status).toBe(401);

  panelAccess.mockResolvedValue({ household: { id: householdA }, user: { id: userA } });
  expect(
    (
      await createKey(
        adminReq("/api/webhooks/keys", "POST", { name: "Origem errada" }, "https://evil.test"),
      )
    ).status,
  ).toBe(403);

  const createdRes = await createKey(
    adminReq("/api/webhooks/keys", "POST", {
      name: "Chave Temporária",
      permissions: ["notify"],
    }),
  );
  expect(createdRes.status).toBe(201);
  const created = await createdRes.json();
  expect(created.key.secret).toMatch(/^sf_wh_[A-Za-z0-9_-]{32}$/);

  const listed = await (await listKeys(adminReq("/api/webhooks/keys", "GET"))).json();
  expect(listed.keys[0]).not.toHaveProperty("keyHash");
  expect(listed.keys[0]).not.toHaveProperty("secret");

  // Casa B não pode revogar chave da Casa A.
  panelAccess.mockResolvedValueOnce({ household: { id: householdB }, user: { id: userB } });
  expect(
    (await deleteKey(adminReq("/api/webhooks/keys", "DELETE", { id: created.key.id }))).status,
  ).toBe(404);

  // Chave apenas com "notify" é rejeitada em /api/push (403) e aceita em /api/notify.
  const deniedPush = await postPush(
    new Request("https://example.test/api/push/ci-main", {
      method: "POST",
      headers: {
        authorization: `Bearer ${created.key.secret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ status: "healthy" }),
    }),
    { params: Promise.resolve({ key: "ci-main" }) },
  );
  expect(deniedPush.status).toBe(403);

  // Revogar chave impede novo uso (401).
  panelAccess.mockResolvedValue({ household: { id: householdA }, user: { id: userA } });
  expect(
    (await deleteKey(adminReq("/api/webhooks/keys", "DELETE", { id: created.key.id }))).status,
  ).toBe(200);

  const revokedNotify = await postNotify(
    new Request("https://example.test/api/notify", {
      method: "POST",
      headers: { "x-webhook-key": created.key.secret, "content-type": "application/json" },
      body: JSON.stringify({ message: "Não deve passar" }),
    }),
  );
  expect(revokedNotify.status).toBe(401);
});

it("rejeita tokens de tablet, query strings e aplica rate limiting em webhooks", async () => {
  panelAccess.mockResolvedValue({ household: { id: householdA }, user: { id: userA } });
  const keyRes = await createKey(
    adminReq("/api/webhooks/keys", "POST", { name: "Integração Completa" }),
  );
  const { key } = await keyRes.json();

  // Token Bearer do tablet não autoriza endpoint de webhook.
  expect(
    (
      await postNotify(
        new Request("https://example.test/api/notify", {
          method: "POST",
          headers: { authorization: `Bearer ${tokenA}`, "content-type": "application/json" },
          body: JSON.stringify({ message: "Token de tablet bloqueado" }),
        }),
      )
    ).status,
  ).toBe(401);

  // Segredo na query string não autoriza endpoint de webhook.
  expect(
    (
      await postNotify(
        new Request(`https://example.test/api/notify?key=${encodeURIComponent(key.secret)}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message: "Query string bloqueada" }),
        }),
      )
    ).status,
  ).toBe(401);

  // Rate limiting retorna 429 quando excede 60 req/min na chave.
  await db.requestLimit.upsert({
    where: { key: `wh:key:${key.id}` },
    create: { key: `wh:key:${key.id}`, windowStart: new Date(), count: 60 },
    update: { windowStart: new Date(), count: 60 },
  });
  const limited = await postNotify(
    new Request("https://example.test/api/notify", {
      method: "POST",
      headers: { authorization: `Bearer ${key.secret}`, "content-type": "application/json" },
      body: JSON.stringify({ message: "Acima do limite" }),
    }),
  );
  expect(limited.status).toBe(429);
  await db.requestLimit.deleteMany({ where: { key: `wh:key:${key.id}` } });
});

it("processa /api/push, /api/notify, /api/goto, /api/refresh e entrega ao player isolado por casa", async () => {
  panelAccess.mockResolvedValue({ household: { id: householdA }, user: { id: userA } });
  const { key } = await (
    await createKey(adminReq("/api/webhooks/keys", "POST", { name: "Runner CI" }))
  ).json();

  // 1. /api/push dispara regra push_event -> goto_page("alerts") e alimenta devMonitor em transação única.
  const ruleUpdateCalls: unknown[] = [];
  const origTx = db.$transaction.bind(db);
  const txSpy = vi.spyOn(db, "$transaction").mockImplementation(((arg: unknown, opts?: unknown) => {
    if (typeof arg === "function") {
      return origTx(async (tx) => {
        const origUpdateMany = tx.device.updateMany.bind(tx.device);
        tx.device.updateMany = ((params: unknown) => {
          ruleUpdateCalls.push(params);
          return origUpdateMany(params as never);
        }) as typeof tx.device.updateMany;
        return (arg as (t: typeof tx) => unknown)(tx);
      }, opts as never);
    }
    return origTx(arg as never, opts as never);
  }) as typeof db.$transaction);
  const pushRes = await postPush(
    new Request("https://example.test/api/push/ci-main", {
      method: "POST",
      headers: { "x-webhook-key": key.secret, "content-type": "application/json" },
      body: JSON.stringify({ status: "failing", detail: "2 testes falharam" }),
    }),
    { params: Promise.resolve({ key: "ci-main" }) },
  );
  txSpy.mockRestore();
  expect(pushRes.status).toBe(200);
  expect(ruleUpdateCalls).toContainEqual(
    expect.objectContaining({
      where: expect.objectContaining({
        id: deviceA,
        activePanelId: panelA,
        activePanelVersionId: expect.any(String),
      }),
    }),
  );
  const pushBody = await pushRes.json();
  expect(pushBody).toMatchObject({ ok: true, key: "ci-main", rulesTriggered: 1 });

  const cfgA1 = await (
    await getConfig(
      new Request(`https://example.test/api/player/config?deviceId=${deviceA}`, {
        headers: { authorization: `Bearer ${tokenA}` },
      }),
    )
  ).json();
  expect(cfgA1.pageDirective).toMatchObject({
    source: "goto",
    pageId: "alerts",
    durationSeconds: 90,
  });
  expect(cfgA1.widgetData.devMonitor.pushedFeeds[0]).toMatchObject({
    key: "ci-main",
    status: "failing",
    detail: "2 testes falharam",
  });

  // Sem status explícito, push usa o status normalizado do feed ("healthy") para regras.
  const healthyPushRes = await postPush(
    new Request("https://example.test/api/push/ci-main", {
      method: "POST",
      headers: { "x-webhook-key": key.secret, "content-type": "application/json" },
      body: JSON.stringify({ detail: "Build concluído" }),
    }),
    { params: Promise.resolve({ key: "ci-main" }) },
  );
  expect(healthyPushRes.status).toBe(200);
  expect(await healthyPushRes.json()).toMatchObject({ rulesTriggered: 1 });
  const cfgAHealthy = await (
    await getConfig(
      new Request(`https://example.test/api/player/config?deviceId=${deviceA}`, {
        headers: { authorization: `Bearer ${tokenA}` },
      }),
    )
  ).json();
  expect(cfgAHealthy.pageDirective).toMatchObject({ source: "goto", pageId: "home" });

  // Casa B não vê o feed da Casa A.
  const cfgB = await (
    await getConfig(
      new Request(`https://example.test/api/player/config?deviceId=${deviceB}`, {
        headers: { authorization: `Bearer ${tokenB}` },
      }),
    )
  ).json();
  expect(cfgB.widgetData.devMonitor.pushedFeeds).toEqual([]);
  expect(cfgB.notifications).toBeUndefined();

  // 2. /api/notify com severidade alert aciona regra notify_event sem loop e entrega notificações.
  const notifyRes = await postNotify(
    new Request("https://example.test/api/notify", {
      method: "POST",
      headers: { authorization: `Bearer ${key.secret}`, "content-type": "application/json" },
      body: JSON.stringify({
        title: "Servidor",
        message: "Disco cheio",
        severity: "alert",
        deviceId: deviceA,
      }),
    }),
  );
  expect(notifyRes.status).toBe(200);
  const notifyData = await notifyRes.json();
  expect(notifyData.rulesTriggered).toBe(1);

  const cfgA2 = await (
    await getConfig(
      new Request(`https://example.test/api/player/config?deviceId=${deviceA}`, {
        headers: { authorization: `Bearer ${tokenA}` },
      }),
    )
  ).json();
  expect(cfgA2.notifications).toHaveLength(2);
  expect(cfgA2.notifications.map((n: { message: string }) => n.message).sort()).toEqual([
    "Disco cheio",
    "Verificar serviço imediatamente",
  ]);

  // Dismiss pelo dispositivo remove da próxima entrega.
  const dismissRes = await postDismissNotification(
    new Request(`https://example.test/api/player/notifications/dismiss?deviceId=${deviceA}`, {
      method: "POST",
      headers: { authorization: `Bearer ${tokenA}`, "content-type": "application/json" },
      body: JSON.stringify({ notificationId: notifyData.notificationId }),
    }),
  );
  expect(dismissRes.status).toBe(200);

  // 3. /api/goto por índice/next e /api/refresh com corpo vazio + isolamento de device.
  expect(
    (
      await postGoto(
        new Request("https://example.test/api/goto/0", {
          method: "POST",
          headers: { authorization: `Bearer ${key.secret}`, "content-type": "application/json" },
          body: JSON.stringify({ deviceId: deviceB }), // dispositivo de outra casa!
        }),
        { params: Promise.resolve({ page: "0" }) },
      )
    ).status,
  ).toBe(404);

  const gotoRes = await postGoto(
    new Request(`https://example.test/api/goto/next?deviceId=${deviceA}&refresh=true`, {
      method: "POST",
      headers: { authorization: `Bearer ${key.secret}` },
    }),
    { params: Promise.resolve({ page: "next" }) },
  );
  expect(gotoRes.status).toBe(200);
  expect(await gotoRes.json()).toMatchObject({
    ok: true,
    page: "next",
    targetDevices: 1,
    refreshed: true,
  });

  const refreshRes = await postRefresh(
    new Request(`https://example.test/api/refresh?deviceId=${deviceA}`, {
      method: "POST",
      headers: { authorization: `Bearer ${key.secret}` },
    }),
  );
  expect(refreshRes.status).toBe(200);

  // 4. Endpoint administrativo /api/webhooks/test.
  const testRes = await postWebhookTest(
    adminReq("/api/webhooks/test", "POST", {
      action: "goto",
      page: "home",
      deviceId: deviceA,
    }),
  );
  expect(testRes.status).toBe(200);
  const cfgA3 = await (
    await getConfig(
      new Request(`https://example.test/api/player/config?deviceId=${deviceA}`, {
        headers: { authorization: `Bearer ${tokenA}` },
      }),
    )
  ).json();
  expect(cfgA3.pageDirective).toMatchObject({ source: "goto", pageId: "home" });
  expect(
    (await db.device.findUniqueOrThrow({ where: { id: deviceA } })).refreshRequestedAt,
  ).toBeNull();
});

it("emite pageDirective a partir de regra time_range quando não há goto explícito", async () => {
  const userC = randomUUID();
  try {
    const uC = await db.user.create({
      data: {
        id: userC,
        name: "Casa C",
        email: `${userC}@test.local`,
        household: { create: { name: "Casa C" } },
      },
      include: { household: true },
    });
    const householdC = uC.household!.id;
    const pairC = await issuePairingCode(db, householdC, userC);
    const redeemedC = await redeemPairingCode(db, pairC.code, "Tablet C");

    panelAccess.mockResolvedValue({ household: { id: householdC }, user: { id: userC } });
    const createdC = await (
      await createPanel(adminReq("/api/panels", "POST", { name: "Painel Horário" }))
    ).json();

    // Calcular janela que cobre exatamente o minuto atual em UTC (start = agora-1h, end = agora+1h).
    const now = new Date();
    const start = new Date(now.getTime() - 3_600_000);
    const end = new Date(now.getTime() + 3_600_000);
    const fmt = (d: Date) =>
      `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;

    await savePanel(
      adminReq("/api/panels", "PUT", {
        id: createdC.id,
        expectedRevision: 1,
        config: {
          ...defaultOnlineDashboard,
          timezone: "UTC",
          widgets: {
            ...defaultOnlineDashboard.widgets,
            weather: { ...defaultOnlineDashboard.widgets.weather, enabled: false },
            currencies: { ...defaultOnlineDashboard.widgets.currencies, enabled: false },
          },
          pages: [
            { id: "p-main", title: "Principal", enabledWidgets: ["clock"] },
            { id: "p-focus", title: "Foco", enabledWidgets: ["pomodoro"] },
          ],
          rules: [
            {
              id: "r-now",
              name: "Foco agora",
              enabled: true,
              trigger: {
                type: "time_range",
                startTime: fmt(start),
                endTime: fmt(end),
                daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
              },
              action: { type: "goto_page", pageId: "p-focus", durationSeconds: 0 },
            },
          ],
        },
      }),
    );
    await publishOnlinePanel(db, {
      householdId: householdC,
      deviceId: redeemedC.deviceId,
      panelId: createdC.id,
      expectedRevision: 2,
      activate: true,
    });

    const cfgC = await (
      await getConfig(
        new Request(`https://example.test/api/player/config?deviceId=${redeemedC.deviceId}`, {
          headers: { authorization: `Bearer ${redeemedC.token}` },
        }),
      )
    ).json();
    expect(cfgC.pageDirective).toMatchObject({
      source: "rule",
      pageId: "p-focus",
      durationSeconds: 0,
    });
    expect(cfgC.pageDirective.id).toMatch(/^schedule:r-now:/);
  } finally {
    await db.household.deleteMany({ where: { ownerId: userC } });
    await db.user.deleteMany({ where: { id: userC } });
  }
});

it("avalia time_range -> show_notification, entrega mais de 10 notificações, retém até o próximo poll e prioriza pageId numérico", async () => {
  const userD = randomUUID();
  try {
    const uD = await db.user.create({
      data: {
        id: userD,
        name: "Casa D",
        email: `${userD}@test.local`,
        household: { create: { name: "Casa D" } },
      },
      include: { household: true },
    });
    const householdD = uD.household!.id;
    const pairD = await issuePairingCode(db, householdD, userD);
    const redeemedD = await redeemPairingCode(db, pairD.code, "Tablet D");

    panelAccess.mockResolvedValue({ household: { id: householdD }, user: { id: userD } });
    const createdD = await (
      await createPanel(adminReq("/api/panels", "POST", { name: "Painel Revisão" }))
    ).json();

    const now = new Date();
    const start = new Date(now.getTime() - 3_600_000);
    const end = new Date(now.getTime() + 3_600_000);
    const fmt = (d: Date) =>
      `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;

    await savePanel(
      adminReq("/api/panels", "PUT", {
        id: createdD.id,
        expectedRevision: 1,
        config: {
          ...defaultOnlineDashboard,
          timezone: "UTC",
          refreshSeconds: 1800,
          widgets: {
            ...defaultOnlineDashboard.widgets,
            weather: { ...defaultOnlineDashboard.widgets.weather, enabled: false },
            currencies: { ...defaultOnlineDashboard.widgets.currencies, enabled: false },
          },
          pages: [
            { id: "1", title: "Página ID 1 na posição 0", enabledWidgets: ["clock"] },
            { id: "0", title: "Página ID 0 na posição 1", enabledWidgets: ["photos"] },
          ],
          rules: [
            {
              id: "r-sched-notify",
              name: "Alerta agendado",
              enabled: true,
              trigger: {
                type: "time_range",
                startTime: fmt(start),
                endTime: fmt(end),
                daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
              },
              action: {
                type: "show_notification",
                title: "Lembrete agendado",
                message: "Revisar painel no horário",
                severity: "info",
                durationSeconds: 10,
              },
            },
          ],
        },
      }),
    );
    await publishOnlinePanel(db, {
      householdId: householdD,
      deviceId: redeemedD.deviceId,
      panelId: createdD.id,
      expectedRevision: 2,
      activate: true,
    });

    const { key } = await (
      await createKey(adminReq("/api/webhooks/keys", "POST", { name: "Chave Revisão" }))
    ).json();

    // 1. /api/goto/1 prioriza a página cujo ID literal é "1" (posição 0), e não o índice 1.
    const gotoRes = await postGoto(
      new Request(`https://example.test/api/goto/1?deviceId=${redeemedD.deviceId}`, {
        method: "POST",
        headers: { authorization: `Bearer ${key.secret}` },
      }),
      { params: Promise.resolve({ page: "1" }) },
    );
    expect(gotoRes.status).toBe(200);

    // 2. Cria 12 notificações + 1 notificação cujo expiresAt de 2min já passou mas está dentro de refreshSeconds (1800s).
    for (let i = 1; i <= 12; i++) {
      await db.deviceNotification.create({
        data: {
          householdId: householdD,
          deviceId: redeemedD.deviceId,
          title: `Aviso ${i}`,
          message: `Mensagem ${i}`,
          severity: "info",
          durationSeconds: 8,
          createdAt: new Date(now.getTime() - (20 - i) * 1000),
          expiresAt: new Date(now.getTime() + 120_000),
        },
      });
    }
    await db.deviceNotification.create({
      data: {
        householdId: householdD,
        deviceId: redeemedD.deviceId,
        title: "Enviada após último poll",
        message: "Ainda dentro de refreshSeconds",
        severity: "warning",
        durationSeconds: 8,
        createdAt: new Date(now.getTime() - 300_000),
        expiresAt: new Date(now.getTime() - 180_000),
      },
    });

    const cfgD = await (
      await getConfig(
        new Request(`https://example.test/api/player/config?deviceId=${redeemedD.deviceId}`, {
          headers: { authorization: `Bearer ${redeemedD.token}` },
        }),
      )
    ).json();

    expect(cfgD.pageDirective).toMatchObject({
      source: "goto",
      pageId: "1",
    });

    // Inclui a notificação retida pelo refreshSeconds, todas as 12 notificações ativas (além das 10 mais novas) e a agendada.
    const messages = cfgD.notifications.map((n: { message: string }) => n.message);
    expect(messages).toContain("Ainda dentro de refreshSeconds");
    expect(messages).toContain("Mensagem 1");
    expect(messages).toContain("Mensagem 2");
    expect(messages).toContain("Mensagem 12");
    expect(messages).toContain("Revisar painel no horário");
    expect(cfgD.notifications.at(-1).id).toMatch(/^schedule:r-sched-notify:/);
  } finally {
    await db.household.deleteMany({ where: { ownerId: userD } });
    await db.user.deleteMany({ where: { id: userD } });
  }
});

it("garante isolamento, broadcast por dispositivo, limites de chaves/feeds, rate limit pré-auth e limpeza ao trocar painel", async () => {
  const userE = randomUUID();
  const fetchSpy = vi.spyOn(globalThis, "fetch");
  try {
    const uE = await db.user.create({
      data: {
        id: userE,
        name: "Casa E",
        email: `${userE}@test.local`,
        household: { create: { name: "Casa E" } },
      },
      include: { household: true },
    });
    const householdE = uE.household!.id;
    const pair1 = await issuePairingCode(db, householdE, userE);
    const dev1 = await redeemPairingCode(db, pair1.code, "Tablet E1");
    const pair2 = await issuePairingCode(db, householdE, userE);
    const dev2 = await redeemPairingCode(db, pair2.code, "Tablet E2");

    panelAccess.mockResolvedValue({ household: { id: householdE }, user: { id: userE } });
    const p1 = await (await createPanel(adminReq("/api/panels", "POST", { name: "Painel E1" }))).json();
    const p2 = await (await createPanel(adminReq("/api/panels", "POST", { name: "Painel E2" }))).json();

    const makePanelCfg = (refreshSeconds: number) => ({
      ...defaultOnlineDashboard,
      refreshSeconds,
      widgets: {
        ...defaultOnlineDashboard.widgets,
        weather: { ...defaultOnlineDashboard.widgets.weather, enabled: true, city: "Florianopolis" },
        currencies: { ...defaultOnlineDashboard.widgets.currencies, enabled: false },
      },
      pages: [
        { id: "home", title: "Início", enabledWidgets: ["clock", "weather"] },
        { id: "alerts", title: "Alertas", enabledWidgets: ["devMonitor"] },
      ],
    });
    await savePanel(
      adminReq("/api/panels", "PUT", { id: p1.id, expectedRevision: 1, config: makePanelCfg(600) }),
    );
    await savePanel(
      adminReq("/api/panels", "PUT", { id: p2.id, expectedRevision: 1, config: makePanelCfg(15) }),
    );

    await publishOnlinePanel(db, {
      householdId: householdE,
      deviceId: dev1.deviceId,
      panelId: p1.id,
      expectedRevision: 2,
      activate: true,
    });
    await publishOnlinePanel(db, {
      householdId: householdE,
      deviceId: dev2.deviceId,
      panelId: p2.id,
      expectedRevision: 2,
      activate: true,
    });
    // Disponibilizar p2 também para dev1 para testar troca via /api/player/panels.
    await publishOnlinePanel(db, {
      householdId: householdE,
      deviceId: dev1.deviceId,
      panelId: p2.id,
      expectedRevision: 2,
      activate: false,
    });

    const { key } = await (
      await createKey(adminReq("/api/webhooks/keys", "POST", { name: "Principal E" }))
    ).json();

    // 1. Auth/Origin/Cache-Control/Payload >16KiB e rejeição de sf_wh_ nas rotas de player.
    expect(
      (await deleteKey(adminReq("/api/webhooks/keys", "DELETE", { id: key.id }, "https://evil.test")))
        .status,
    ).toBe(403);
    panelAccess.mockResolvedValueOnce(null);
    expect(
      (await postWebhookTest(adminReq("/api/webhooks/test", "POST", { action: "refresh" }))).status,
    ).toBe(401);
    panelAccess.mockResolvedValue({ household: { id: householdE }, user: { id: userE } });
    expect(
      (
        await postWebhookTest(
          adminReq("/api/webhooks/test", "POST", { action: "refresh" }, "https://evil.test"),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await postWebhookTest(
          adminReq("/api/webhooks/test", "POST", { action: "refresh", deviceId: deviceB }),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await getConfig(
          new Request("https://example.test/api/player/config", {
            headers: { authorization: `Bearer ${key.secret}` },
          }),
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await postDismissNotification(
          new Request("https://example.test/api/player/notifications/dismiss", {
            method: "POST",
            headers: { authorization: `Bearer ${key.secret}`, "content-type": "application/json" },
            body: JSON.stringify({ notificationId: "n1" }),
          }),
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await postDismissNotification(
          new Request(`https://example.test/api/player/notifications/dismiss?deviceId=${dev2.deviceId}`, {
            method: "POST",
            headers: { authorization: `Bearer ${dev1.token}`, "content-type": "application/json" },
            body: JSON.stringify({ notificationId: "n1" }),
          }),
        )
      ).status,
    ).toBe(403);

    const bigPayloadRes = await postNotify(
      new Request("https://example.test/api/notify", {
        method: "POST",
        headers: { authorization: `Bearer ${key.secret}`, "content-type": "application/json" },
        body: JSON.stringify({ message: "x".repeat(17_000) }),
      }),
    );
    expect(bigPayloadRes.status).toBe(413);
    expect(bigPayloadRes.headers.get("cache-control")).toBe("private, no-store");

    // 2. Combinação incompatível deviceId + panelId retorna 404 sem gravar notificação;
    // IDOR cross-household em panelId retorna 404.
    expect(
      (
        await postNotify(
          new Request("https://example.test/api/notify", {
            method: "POST",
            headers: { authorization: `Bearer ${key.secret}`, "content-type": "application/json" },
            body: JSON.stringify({ message: "Incompatível", deviceId: dev1.deviceId, panelId: p2.id }),
          }),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await postRefresh(
          new Request("https://example.test/api/refresh", {
            method: "POST",
            headers: { authorization: `Bearer ${key.secret}`, "content-type": "application/json" },
            body: JSON.stringify({ panelId: panelA }),
          }),
        )
      ).status,
    ).toBe(404);

    // 3. Broadcast cria entrega por tablet: dispensar em dev1 não suprime em dev2 nem aceita IDOR.
    const broadcastRes = await postNotify(
      new Request("https://example.test/api/notify", {
        method: "POST",
        headers: { authorization: `Bearer ${key.secret}`, "content-type": "application/json" },
        body: JSON.stringify({ message: "Aviso geral" }),
      }),
    );
    expect(broadcastRes.status).toBe(200);
    expect((await broadcastRes.json()).deliveredToDevices).toBe(2);

    const cfgE1 = await (
      await getConfig(
        new Request(`https://example.test/api/player/config?deviceId=${dev1.deviceId}`, {
          headers: { authorization: `Bearer ${dev1.token}` },
        }),
      )
    ).json();
    const cfgE2 = await (
      await getConfig(
        new Request(`https://example.test/api/player/config?deviceId=${dev2.deviceId}`, {
          headers: { authorization: `Bearer ${dev2.token}` },
        }),
      )
    ).json();
    expect(cfgE1.notifications).toHaveLength(1);
    expect(cfgE2.notifications).toHaveLength(1);

    // dev2 tenta dispensar a notificação de dev1 (isolamento por dispositivo).
    await postDismissNotification(
      new Request("https://example.test/api/player/notifications/dismiss", {
        method: "POST",
        headers: { authorization: `Bearer ${dev2.token}`, "content-type": "application/json" },
        body: JSON.stringify({ notificationId: cfgE1.notifications[0].id }),
      }),
    );
    // dev1 dispensa a sua própria.
    await postDismissNotification(
      new Request("https://example.test/api/player/notifications/dismiss", {
        method: "POST",
        headers: { authorization: `Bearer ${dev1.token}`, "content-type": "application/json" },
        body: JSON.stringify({ notificationId: cfgE1.notifications[0].id }),
      }),
    );
    const cfgE1After = await (
      await getConfig(
        new Request(`https://example.test/api/player/config?deviceId=${dev1.deviceId}`, {
          headers: { authorization: `Bearer ${dev1.token}` },
        }),
      )
    ).json();
    const cfgE2After = await (
      await getConfig(
        new Request(`https://example.test/api/player/config?deviceId=${dev2.deviceId}`, {
          headers: { authorization: `Bearer ${dev2.token}` },
        }),
      )
    ).json();
    expect(cfgE1After.notifications).toBeUndefined();
    expect(cfgE2After.notifications).toHaveLength(1);

    // 4. /api/goto considera refreshSeconds: 600 no targetPageExpiresAt e trocar painel limpa targetPage*.
    const beforeGoto = Date.now();
    const guardedGotoUpdate = vi.spyOn(db.device, "updateMany");
    await postGoto(
      new Request(`https://example.test/api/goto/alerts?deviceId=${dev1.deviceId}&durationSeconds=30`, {
        method: "POST",
        headers: { authorization: `Bearer ${key.secret}` },
      }),
      { params: Promise.resolve({ page: "alerts" }) },
    );
    expect(guardedGotoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: dev1.deviceId,
          activePanelId: p1.id,
          activePanelVersionId: expect.any(String),
        }),
      }),
    );
    guardedGotoUpdate.mockRestore();
    const dev1Row = await db.device.findUniqueOrThrow({ where: { id: dev1.deviceId } });
    expect(dev1Row.targetPageExpiresAt!.getTime() - beforeGoto).toBeGreaterThanOrEqual(650_000);

    await switchPlayerPanel(
      new Request("https://example.test/api/player/panels", {
        method: "POST",
        headers: { authorization: `Bearer ${dev1.token}`, "content-type": "application/json" },
        body: JSON.stringify({ panelId: p2.id }),
      }),
    );
    const cfgE1Switched = await (
      await getConfig(
        new Request(`https://example.test/api/player/config?deviceId=${dev1.deviceId}`, {
          headers: { authorization: `Bearer ${dev1.token}` },
        }),
      )
    ).json();
    expect(cfgE1Switched.pageDirective).toBeUndefined();

    // 5. feedKey de 64 chars e teto de 50 feeds push:*.
    const longKey = "a".repeat(64);
    expect(
      (
        await postPush(
          new Request(`https://example.test/api/push/${longKey}`, {
            method: "POST",
            headers: { authorization: `Bearer ${key.secret}`, "content-type": "application/json" },
            body: JSON.stringify({ status: "healthy" }),
          }),
          { params: Promise.resolve({ key: longKey }) },
        )
      ).status,
    ).toBe(200);
    await db.widgetSnapshot.update({
      where: { key: `push:${householdE}:${longKey}` },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    for (let i = 1; i <= 50; i++) {
      await db.widgetSnapshot.create({
        data: {
          key: `push:${householdE}:seed-${i}`,
          payload: { key: `seed-${i}`, name: `Seed ${i}`, category: "service", status: "healthy", detail: "", value: null, updatedAt: new Date().toISOString() },
          updatedAt: new Date(),
          expiresAt: new Date(Date.now() + 600_000),
        },
      });
    }
    const expiredFeedReuse = await postPush(
      new Request(`https://example.test/api/push/${longKey}`, {
        method: "POST",
        headers: { authorization: `Bearer ${key.secret}`, "content-type": "application/json" },
        body: JSON.stringify({ status: "healthy" }),
      }),
      { params: Promise.resolve({ key: longKey }) },
    );
    expect(expiredFeedReuse.status).toBe(409);
    expect(
      (
        await postPush(
          new Request("https://example.test/api/push/overflow-feed", {
            method: "POST",
            headers: { authorization: `Bearer ${key.secret}`, "content-type": "application/json" },
            body: JSON.stringify({ status: "healthy" }),
          }),
          { params: Promise.resolve({ key: "overflow-feed" }) },
        )
      ).status,
    ).toBe(409);

    // 6. listWebhookKeys preserva chave ativa mesmo após >50 revogações + limite de 25 ativas + DELETE ?id=.
    for (let i = 0; i < 52; i++) {
      await db.webhookKey.create({
        data: {
          householdId: householdE,
          name: `Revogada ${i}`,
          keyHash: `revoked-hash-${userE}-${i}`,
          keyPrefix: "sf_wh_rev",
          revokedAt: new Date(),
        },
      });
    }
    const keysAfterRevocations = await (await listKeys(adminReq("/api/webhooks/keys", "GET"))).json();
    expect(keysAfterRevocations.keys.some((item: { id: string }) => item.id === key.id)).toBe(true);
    const tempKey = await (
      await createKey(adminReq("/api/webhooks/keys", "POST", { name: "Via Query" }))
    ).json();
    expect(
      (await deleteKey(adminReq(`/api/webhooks/keys?id=${tempKey.key.id}`, "DELETE"))).status,
    ).toBe(200);

    // 7. Single-flight em POST /api/refresh com 2 dispositivos compartilhando a mesma cidade.
    await db.widgetSnapshot.deleteMany({ where: { key: "online:weather:florianopolis" } });
    fetchSpy.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("geocoding-api.open-meteo.com")) {
        return Response.json({
          results: [{ id: 1, name: "Florianopolis", latitude: -27.6, longitude: -48.5, country: "Brazil", timezone: "America/Sao_Paulo" }],
        });
      }
      return Response.json({
        current: { temperature_2m: 25, weather_code: 1 },
        daily: { temperature_2m_min: [20], temperature_2m_max: [28] },
      });
    });
    expect(
      (
        await postRefresh(
          new Request("https://example.test/api/refresh", {
            method: "POST",
            headers: { authorization: `Bearer ${key.secret}` },
          }),
        )
      ).status,
    ).toBe(200);
    await new Promise((r) => setTimeout(r, 30));
    const forecastCalls = fetchSpy.mock.calls.filter(([u]) =>
      String(u).includes("api.open-meteo.com"),
    );
    expect(forecastCalls).toHaveLength(1);

    // 8. Tentativas inválidas usam bucket próprio e não consomem a cota de chamadas válidas.
    const invalidSecret = `sf_wh_${"z".repeat(32)}`;
    const validGlobalLimitKey = "wh:global";
    const globalLimitBeforeInvalid = await db.requestLimit.findUnique({
      where: { key: validGlobalLimitKey },
    });
    const preAuthTest = await postNotify(
      new Request("https://example.test/api/notify", {
        method: "POST",
        headers: {
          authorization: `Bearer ${invalidSecret}`,
          "x-forwarded-for": "1.2.3.4, 203.0.113.99",
          "content-type": "application/json",
        },
        body: JSON.stringify({ message: "Probe" }),
      }),
    );
    expect(preAuthTest.status).toBe(401);
    expect(
      await db.requestLimit.findUnique({ where: { key: validGlobalLimitKey } }),
    ).toEqual(globalLimitBeforeInvalid);
    const ipLimitKey = `wh:invalid:${(await import("node:crypto")).createHash("sha256").update("unknown").digest("hex")}`;
    await db.requestLimit.update({
      where: { key: ipLimitKey },
      data: { count: 120 },
    });
    const invalidBucketBlocked = await postNotify(
      new Request("https://example.test/api/notify", {
        method: "POST",
        headers: {
          authorization: `Bearer ${invalidSecret}`,
          "x-forwarded-for": "9.9.9.9, 203.0.113.99",
          "content-type": "application/json",
        },
        body: JSON.stringify({ message: "Blocked" }),
      }),
    );
    expect(invalidBucketBlocked.status).toBe(429);
    await db.requestLimit.deleteMany({ where: { key: ipLimitKey } });

    // Even when invalid-credential traffic is throttled, valid credentials remain usable.
    const validAfterInvalid = await postNotify(
      new Request("https://example.test/api/notify", {
        method: "POST",
        headers: {
          authorization: `Bearer ${key.secret}`,
          "x-real-ip": "198.51.100.24",
          "content-type": "application/json",
        },
        body: JSON.stringify({ message: "Usuário válido não bloqueado" }),
      }),
    );
    expect(validAfterInvalid.status).toBe(200);
  } finally {
    fetchSpy.mockRestore();
    await db.widgetSnapshot.deleteMany({
      where: {
        OR: [{ key: { startsWith: "push:" } }, { key: "online:weather:florianopolis" }],
      },
    });
    await db.household.deleteMany({ where: { ownerId: userE } });
    await db.user.deleteMany({ where: { id: userE } });
  }
});
