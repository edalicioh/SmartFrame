import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import {
  evaluateEventRules,
  gotoPageParamSchema,
  gotoPayloadSchema,
  isSafePublicHttpsUrl,
  notifyPayloadSchema,
  pushedFeedEntrySchema,
  pushKeySchema,
  pushPayloadSchema,
  readStoredOnlineDashboard,
  refreshPayloadSchema,
  webhookKeyCreateSchema,
  webhookPermissions,
  type DashboardWidgetKey,
  type OnlineDashboard,
  type RuleEvent,
  type WebhookPermission,
} from "@smartframe/contracts";
import type { PrismaClient } from "@smartframe/database";
import { refreshOnlineWidgets } from "@smartframe/widgets";
import { FrameError } from "./index";

type TransactionClient = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
type WebhookDbClient = PrismaClient | TransactionClient;

const MAX_ACTIVE_WEBHOOK_KEYS = 25;
const MAX_ACTIVE_PUSH_FEEDS = 50;
const MAX_ACTIVE_NOTIFICATIONS_PER_DEVICE = 50;
const MAX_RULE_NOTIFICATIONS_PER_EVENT = 100;
const WEBHOOK_SECRET_PATTERN = /^sf_wh_[A-Za-z0-9_-]{32}$/;
const LAST_USED_UPDATE_INTERVAL_MS = 60_000;
const RATE_WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_KEY_PER_MINUTE = 60;
const MAX_REQUESTS_PER_IP_PER_MINUTE = 120;
const MAX_GLOBAL_REQUESTS_PER_MINUTE = 300;

const digest = (value: string) => createHash("sha256").update(value).digest("hex");

function parsePermissions(raw: string): WebhookPermission[] {
  const allowed = new Set<string>(webhookPermissions);
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter((item): item is WebhookPermission => allowed.has(item));
}

function extractWebhookSecret(request: Request): string | null {
  const headerKey = request.headers.get("x-webhook-key")?.trim();
  if (headerKey) return headerKey;
  const auth = request.headers.get("authorization");
  const match = /^Bearer\s+([A-Za-z0-9_-]+)$/i.exec(auth ?? "");
  return match ? match[1] : null;
}

function extractClientIp(): string {
  // These headers are attacker-controlled when Next.js is reached directly.
  // Until the deployment exposes a verified socket/proxy address, share a
  // bounded pre-auth bucket rather than letting callers mint arbitrary buckets.
  return "unknown";
}

async function applyRateBuckets(
  db: PrismaClient,
  buckets: ReadonlyArray<readonly [string, number]>,
) {
  const now = new Date();
  await db.$transaction(async (tx) => {
    for (const [limitKey, max] of buckets) {
      const record = await tx.requestLimit.upsert({
        where: { key: limitKey },
        create: { key: limitKey, windowStart: now, count: 1 },
        update: { count: { increment: 1 } },
      });
      if (now.getTime() - record.windowStart.getTime() >= RATE_WINDOW_MS) {
        await tx.requestLimit.update({
          where: { key: limitKey },
          data: { count: 1, windowStart: now },
        });
      } else if (record.count > max) {
        throw new FrameError(429, "Limite de requisições de webhook excedido. Aguarde um minuto.");
      }
    }
  });
}

async function limitInvalidWebhookCredential(db: PrismaClient) {
  // Failed credentials have their own bucket; they can never consume valid-key
  // or valid-traffic global capacity. Do not trust forwarded IP headers here.
  await applyRateBuckets(db, [[`wh:invalid:${digest(extractClientIp())}`, MAX_REQUESTS_PER_IP_PER_MINUTE]]);
}

async function limitWebhookKey(db: PrismaClient, keyId: string) {
  await applyRateBuckets(db, [
    ["wh:global", MAX_GLOBAL_REQUESTS_PER_MINUTE],
    [`wh:key:${keyId}`, MAX_REQUESTS_PER_KEY_PER_MINUTE],
  ]);
}

function directiveTtlSeconds(durationSeconds: number, refreshSeconds: number | undefined): number {
  const refreshSec = refreshSeconds ?? 15;
  return Math.max(durationSeconds || 300, refreshSec + 60, 120);
}

export async function createWebhookKey(
  db: PrismaClient,
  householdId: string,
  actorId: string,
  input: unknown,
) {
  const parsed = webhookKeyCreateSchema.parse(input);
  const secret = `sf_wh_${randomBytes(24).toString("base64url")}`;
  const keyHash = digest(secret);
  const keyPrefix = secret.slice(0, 12);
  const permissions = parsed.permissions.join(",");

  const created = await db.$transaction(async (tx) => {
    const activeCount = await tx.webhookKey.count({
      where: { householdId, revokedAt: null },
    });
    if (activeCount >= MAX_ACTIVE_WEBHOOK_KEYS) {
      throw new FrameError(
        409,
        `Limite de ${MAX_ACTIVE_WEBHOOK_KEYS} chaves de webhook ativas atingido. Revogue uma chave antiga.`,
      );
    }
    const row = await tx.webhookKey.create({
      data: {
        householdId,
        name: parsed.name,
        keyHash,
        keyPrefix,
        permissions,
      },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        permissions: true,
        createdAt: true,
      },
    });
    await tx.auditLog.create({
      data: { householdId, actorId, action: "webhook.key.created" },
    });
    return row;
  });

  return {
    id: created.id,
    name: created.name,
    keyPrefix: created.keyPrefix,
    permissions: parsePermissions(created.permissions),
    createdAt: created.createdAt.toISOString(),
    secret,
  };
}

export async function listWebhookKeys(db: PrismaClient, householdId: string) {
  const select = {
    id: true,
    name: true,
    keyPrefix: true,
    permissions: true,
    createdAt: true,
    lastUsedAt: true,
    revokedAt: true,
  } as const;
  const [active, revoked] = await Promise.all([
    db.webhookKey.findMany({
      where: { householdId, revokedAt: null },
      select,
      orderBy: { createdAt: "desc" },
      take: MAX_ACTIVE_WEBHOOK_KEYS,
    }),
    db.webhookKey.findMany({
      where: { householdId, revokedAt: { not: null } },
      select,
      orderBy: { createdAt: "desc" },
      take: 25,
    }),
  ]);
  return [...active, ...revoked].map((row) => ({
    id: row.id,
    name: row.name,
    keyPrefix: row.keyPrefix,
    permissions: parsePermissions(row.permissions),
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
  }));
}

export async function revokeWebhookKey(
  db: PrismaClient,
  householdId: string,
  actorId: string,
  id: string,
) {
  if (!id || typeof id !== "string" || id.length > 128) {
    throw new FrameError(400, "Identificador da chave de webhook inválido.");
  }
  await db.$transaction(async (tx) => {
    const updated = await tx.webhookKey.updateMany({
      where: { id, householdId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (updated.count !== 1) {
      throw new FrameError(404, "Chave de webhook não encontrada.");
    }
    await tx.auditLog.create({
      data: { householdId, actorId, action: "webhook.key.revoked" },
    });
  });
}

export async function authorizeWebhook(
  db: PrismaClient,
  request: Request,
  requiredPermission: WebhookPermission,
) {
  const secret = extractWebhookSecret(request);
  if (!secret || !WEBHOOK_SECRET_PATTERN.test(secret)) {
    await limitInvalidWebhookCredential(db);
    throw new FrameError(401, "Chave de webhook necessária ou inválida.");
  }

  const keyHash = digest(secret);
  const record = await db.webhookKey.findUnique({
    where: { keyHash },
  });
  const storedBuf = record ? Buffer.from(record.keyHash, "hex") : null;
  const candidateBuf = Buffer.from(keyHash, "hex");
  if (
    !record ||
    record.revokedAt !== null ||
    !storedBuf ||
    storedBuf.length !== candidateBuf.length ||
    !timingSafeEqual(storedBuf, candidateBuf)
  ) {
    await limitInvalidWebhookCredential(db);
    throw new FrameError(401, "Chave de webhook inválida ou revogada.");
  }
  await limitWebhookKey(db, record.id);

  const permissions = parsePermissions(record.permissions);
  if (!permissions.includes(requiredPermission)) {
    throw new FrameError(403, "Chave de webhook sem permissão para esta operação.");
  }

  const now = new Date();
  if (
    !record.lastUsedAt ||
    now.getTime() - record.lastUsedAt.getTime() > LAST_USED_UPDATE_INTERVAL_MS
  ) {
    await db.webhookKey.updateMany({
      where: { id: record.id, revokedAt: null },
      data: { lastUsedAt: now },
    });
  }

  return {
    householdId: record.householdId,
    webhookKeyId: record.id,
    name: record.name,
    permissions,
  };
}

type ResolvedDevice = {
  id: string;
  householdId: string;
  activePanelId: string | null;
  activePanelVersionId: string | null;
  resolvedPanelId: string | null;
  config: OnlineDashboard | null;
};

async function resolveDeviceActiveConfig(
  db: WebhookDbClient,
  device: {
    id: string;
    householdId: string;
    activePanelId: string | null;
    activePanelVersionId: string | null;
  },
): Promise<OnlineDashboard | null> {
  let rawConfig: unknown = null;
  if (device.activePanelId) {
    const version = await db.layoutVersion.findFirst({
      where: {
        id: device.activePanelVersionId ?? "",
        layoutId: device.activePanelId,
        layout: { householdId: device.householdId },
      },
      select: { config: true },
    });
    rawConfig = version?.config ?? null;
  } else {
    const legacyLayout = await db.layout.findFirst({
      where: { key: `online:${device.id}`, householdId: device.householdId },
      include: { publishedVersion: true },
    });
    if (
      legacyLayout?.publishedVersion &&
      legacyLayout.publishedVersion.layoutId === legacyLayout.id
    ) {
      rawConfig = legacyLayout.publishedVersion.config;
    }
  }
  if (!rawConfig) return null;
  try {
    return readStoredOnlineDashboard(rawConfig);
  } catch {
    return null;
  }
}

async function resolveTargetDevices(
  db: WebhookDbClient,
  householdId: string,
  target: { deviceId?: string; panelId?: string },
): Promise<ResolvedDevice[]> {
  if (target.panelId) {
    const panel = await db.layout.findFirst({
      where: {
        id: target.panelId,
        householdId,
        OR: [{ key: { startsWith: "panel:" } }, { key: { startsWith: "online:" } }],
      },
      select: { id: true },
    });
    if (!panel) throw new FrameError(404, "Painel não encontrado.");
  }
  if (target.deviceId) {
    const exists = await db.device.findFirst({
      where: { id: target.deviceId, householdId, revokedAt: null },
      select: { id: true },
    });
    if (!exists) throw new FrameError(404, "Dispositivo não encontrado.");
  }
  const devices = await db.device.findMany({
    where: {
      householdId,
      revokedAt: null,
      ...(target.deviceId ? { id: target.deviceId } : {}),
      ...(target.panelId
        ? { OR: [{ activePanelId: target.panelId }, { activePanelId: null }] }
        : {}),
    },
    select: {
      id: true,
      householdId: true,
      activePanelId: true,
      activePanelVersionId: true,
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const resolved = await Promise.all(
    devices.map(async (device) => {
      let resolvedPanelId = device.activePanelId;
      if (!resolvedPanelId) {
        const legacyLayout = await db.layout.findFirst({
          where: { key: `online:${device.id}`, householdId: device.householdId },
          include: { publishedVersion: true },
        });
        if (
          legacyLayout &&
          legacyLayout.publishedVersion?.layoutId === legacyLayout.id
        ) {
          resolvedPanelId = legacyLayout.id;
        }
      }
      return {
        ...device,
        resolvedPanelId,
        config: await resolveDeviceActiveConfig(db, device),
      };
    }),
  );
  return target.panelId
    ? resolved.filter((device) => device.resolvedPanelId === target.panelId)
    : resolved;
}

type NotificationDraft = {
  householdId: string;
  deviceId: string;
  title: string | null;
  message: string;
  severity: string;
  durationSeconds: number;
  expiresAt: Date;
};

async function createDeviceNotificationsWithCap(
  tx: TransactionClient,
  drafts: readonly NotificationDraft[],
): Promise<string> {
  if (drafts.length === 0) return "";
  let firstId = "";
  for (const draft of drafts) {
    const created = await tx.deviceNotification.create({
      data: draft,
      select: { id: true },
    });
    if (!firstId) firstId = created.id;
    const overflow = await tx.deviceNotification.findMany({
      where: {
        householdId: draft.householdId,
        deviceId: draft.deviceId,
        dismissedAt: null,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: MAX_ACTIVE_NOTIFICATIONS_PER_DEVICE,
      select: { id: true },
    });
    if (overflow.length > 0) {
      await tx.deviceNotification.deleteMany({
        where: { id: { in: overflow.map((item) => item.id) } },
      });
    }
  }
  return firstId;
}

async function applyRuleActions(
  tx: TransactionClient,
  householdId: string,
  devices: ResolvedDevice[],
  event: RuleEvent,
): Promise<number> {
  let triggered = 0;
  const now = new Date();
  const notificationDrafts: NotificationDraft[] = [];

  for (const device of devices) {
    if (!device.config?.rules?.length) continue;
    const matches = evaluateEventRules(device.config.rules, event);
    for (const rule of matches) {
      const action = rule.action;
      if (action.type === "goto_page") {
        const hasPage = Boolean(device.config.pages?.some((page) => page.id === action.pageId));
        if (!hasPage) continue;
        triggered += 1;
        const duration = action.durationSeconds;
        const ttlSeconds = directiveTtlSeconds(duration, device.config.refreshSeconds);
        await tx.device.updateMany({
          where: {
            id: device.id,
            householdId,
            revokedAt: null,
            activePanelId: device.activePanelId,
            activePanelVersionId: device.activePanelVersionId,
          },
          data: {
            targetPageId: action.pageId,
            targetPageNonce: randomUUID(),
            targetPageDuration: duration,
            targetPageExpiresAt: new Date(now.getTime() + ttlSeconds * 1000),
          },
        });
      } else if (notificationDrafts.length < MAX_RULE_NOTIFICATIONS_PER_EVENT) {
        triggered += 1;
        const refreshSec = device.config.refreshSeconds ?? 15;
        const expiresAt = new Date(
          now.getTime() +
            Math.max(action.durationSeconds + 90, refreshSec + action.durationSeconds + 30, 120) *
              1000,
        );
        notificationDrafts.push({
          householdId,
          deviceId: device.id,
          title: action.title.trim() || null,
          message: action.message,
          severity: action.severity,
          durationSeconds: action.durationSeconds,
          expiresAt,
        });
      }
    }
  }

  if (notificationDrafts.length > 0) {
    await createDeviceNotificationsWithCap(tx, notificationDrafts);
  }
  return triggered;
}

function triggerDeviceWidgetRefresh(db: PrismaClient, devices: ResolvedDevice[]) {
  const weatherCities = new Map<string, string>();
  const currencyPairs = new Set<string>();
  const rssFeeds = new Map<string, number>();

  for (const device of devices) {
    const config = device.config;
    if (!config) continue;
    const pageEnabledWidgets = new Set(config.pages?.flatMap((page) => page.enabledWidgets) ?? []);
    const enabled = (key: DashboardWidgetKey) =>
      config.widgets[key].enabled || pageEnabledWidgets.has(key);

    if (enabled("weather")) {
      const cityKey = config.widgets.weather.city.trim().toLocaleLowerCase("pt-BR");
      if (cityKey && !weatherCities.has(cityKey)) {
        weatherCities.set(cityKey, config.widgets.weather.city.trim());
      }
    }
    if (enabled("currencies")) {
      for (const pair of config.widgets.currencies.pairs) {
        currencyPairs.add(pair);
      }
    }
    if (enabled("rss") && isSafePublicHttpsUrl(config.widgets.rss.feedUrl)) {
      const url = config.widgets.rss.feedUrl.trim();
      const prevMax = rssFeeds.get(url) ?? 0;
      rssFeeds.set(url, Math.max(prevMax, config.widgets.rss.maxItems));
    }
  }

  const cityList = [...weatherCities.values()];
  const pairList = [...currencyPairs];
  const rssList = [...rssFeeds.entries()];
  const pairBatches = Math.ceil(pairList.length / 20);
  const rounds = Math.max(cityList.length, rssList.length, pairBatches);

  for (let index = 0; index < rounds; index++) {
    const city = cityList[index];
    const rss = rssList[index];
    void refreshOnlineWidgets(
      db,
      {
        weather: city ? { enabled: true, city } : { enabled: false, city: "Camboriú" },
        currencies:
          index < pairBatches
            ? { enabled: true, pairs: pairList.slice(index * 20, (index + 1) * 20) }
            : { enabled: false },
        rss: rss
          ? { enabled: true, feedUrl: rss[0], maxItems: rss[1] }
          : { enabled: false, feedUrl: "" },
      },
      true,
    ).catch(() => {});
  }
}

export async function handleWebhookPush(
  db: PrismaClient,
  householdId: string,
  rawKey: string,
  input: unknown,
) {
  const feedKey = pushKeySchema.parse(rawKey);
  const parsed = pushPayloadSchema.parse(input);
  const now = new Date();
  const detail =
    parsed.detail ??
    parsed.text ??
    (parsed.value !== undefined ? String(parsed.value).slice(0, 120) : "");
  const entry = pushedFeedEntrySchema.parse({
    key: feedKey,
    name: parsed.name ?? parsed.title ?? feedKey.slice(0, 60),
    category: parsed.category ?? "service",
    status: parsed.status ?? "healthy",
    detail,
    value: parsed.value ?? null,
    updatedAt: now.toISOString(),
  });

  const snapshotKey = `push:${householdId}:${feedKey}`;
  const expiresAt = new Date(now.getTime() + parsed.ttlSeconds * 1000);
  const rulesTriggered = await db.$transaction(async (tx) => {
    const existing = await tx.widgetSnapshot.findUnique({
      where: { key: snapshotKey },
      select: { key: true, expiresAt: true },
    });
    if (!existing || existing.expiresAt <= now) {
      const activeCount = await tx.widgetSnapshot.count({
        where: {
          key: { startsWith: `push:${householdId}:` },
          expiresAt: { gt: now },
        },
      });
      if (activeCount >= MAX_ACTIVE_PUSH_FEEDS) {
        throw new FrameError(
          409,
          `Limite de ${MAX_ACTIVE_PUSH_FEEDS} feeds externos ativos atingido.`,
        );
      }
    }
    await tx.widgetSnapshot.upsert({
      where: { key: snapshotKey },
      create: {
        key: snapshotKey,
        payload: entry,
        updatedAt: now,
        expiresAt,
        failedAt: null,
      },
      update: {
        payload: entry,
        updatedAt: now,
        expiresAt,
        failedAt: null,
      },
    });
    const devices = await resolveTargetDevices(tx, householdId, {});
    return applyRuleActions(tx, householdId, devices, {
      type: "push_event",
      feedKey,
      status: entry.status,
    });
  });

  return {
    ok: true,
    key: feedKey,
    updatedAt: entry.updatedAt,
    rulesTriggered,
  };
}

export async function handleWebhookNotify(
  db: PrismaClient,
  householdId: string,
  input: unknown,
  options?: { skipRules?: boolean },
) {
  const parsed = notifyPayloadSchema.parse(input);
  const now = new Date();
  const { notificationId, deliveredToDevices, rulesTriggered } = await db.$transaction(
    async (tx) => {
      const targetDevices = await resolveTargetDevices(tx, householdId, {
        deviceId: parsed.deviceId,
        panelId: parsed.panelId,
      });
      if (parsed.deviceId && parsed.panelId && targetDevices.length === 0) {
        throw new FrameError(404, "Dispositivo não está exibindo o painel informado.");
      }

      const drafts: NotificationDraft[] = targetDevices.map((device) => {
        const refreshSeconds = device.config?.refreshSeconds ?? 15;
        const expiresAt = new Date(
          now.getTime() +
            Math.max(parsed.durationSeconds + 90, refreshSeconds + parsed.durationSeconds + 30, 120) *
              1000,
        );
        return {
          householdId,
          deviceId: device.id,
          title: parsed.title?.trim() || null,
          message: parsed.message,
          severity: parsed.severity,
          durationSeconds: parsed.durationSeconds,
          expiresAt,
        };
      });

      const createdId = await createDeviceNotificationsWithCap(tx, drafts);
      let ruleCount = 0;
      if (!options?.skipRules && targetDevices.length > 0) {
        ruleCount = await applyRuleActions(tx, householdId, targetDevices, {
          type: "notify_event",
          severity: parsed.severity,
        });
      }
      return {
        notificationId: createdId,
        deliveredToDevices: targetDevices.length,
        rulesTriggered: ruleCount,
      };
    },
  );

  return {
    ok: true,
    notificationId,
    deliveredToDevices,
    rulesTriggered,
  };
}

function resolvePageTarget(rawPage: string, config: OnlineDashboard | null): string | null {
  if (!config?.pages?.length) return null;
  const exact = config.pages.find((page) => page.id === rawPage);
  if (exact) return exact.id;
  if (rawPage === "next" || rawPage === "prev") {
    return config.pages.length > 1 ? rawPage : null;
  }
  if (/^[0-7]$/.test(rawPage)) {
    return config.pages[Number(rawPage)]?.id ?? null;
  }
  return null;
}

export async function handleWebhookGoto(
  db: PrismaClient,
  householdId: string,
  rawPage: string,
  input: unknown,
) {
  const pageParam = gotoPageParamSchema.parse(rawPage);
  const parsed = gotoPayloadSchema.parse(input ?? {});
  const devices = await resolveTargetDevices(db, householdId, {
    deviceId: parsed.deviceId,
    panelId: parsed.panelId,
  });

  const now = new Date();
  const matchedDevices: Array<{ device: ResolvedDevice; pageId: string; expiresAt: Date }> = [];

  for (const device of devices) {
    const resolved = resolvePageTarget(pageParam, device.config);
    if (resolved) {
      const ttlSeconds = directiveTtlSeconds(
        parsed.durationSeconds,
        device.config?.refreshSeconds,
      );
      matchedDevices.push({
        device,
        pageId: resolved,
        expiresAt: new Date(now.getTime() + ttlSeconds * 1000),
      });
    }
  }

  if (parsed.deviceId && matchedDevices.length === 0) {
    throw new FrameError(404, "Página não encontrada no painel ativo do dispositivo.");
  }

  if (matchedDevices.length > 0) {
    await db.$transaction(
      matchedDevices.map(({ device, pageId, expiresAt }) =>
        db.device.updateMany({
          where: {
            id: device.id,
            householdId,
            revokedAt: null,
            activePanelId: device.activePanelId,
            activePanelVersionId: device.activePanelVersionId,
          },
          data: {
            targetPageId: pageId,
            targetPageNonce: randomUUID(),
            targetPageDuration: parsed.durationSeconds,
            targetPageExpiresAt: expiresAt,
            ...(parsed.refresh ? { refreshRequestedAt: now } : {}),
          },
        }),
      ),
    );
  }

  if (parsed.refresh && matchedDevices.length > 0) {
    triggerDeviceWidgetRefresh(
      db,
      matchedDevices.map((entry) => entry.device),
    );
  }

  return {
    ok: true,
    page: pageParam,
    targetDevices: matchedDevices.length,
    refreshed: parsed.refresh,
  };
}

export async function handleWebhookRefresh(db: PrismaClient, householdId: string, input: unknown) {
  const parsed = refreshPayloadSchema.parse(input ?? {});
  const devices = await resolveTargetDevices(db, householdId, {
    deviceId: parsed.deviceId,
    panelId: parsed.panelId,
  });
  const now = new Date();

  if (devices.length > 0) {
    await db.device.updateMany({
      where: {
        id: { in: devices.map((device) => device.id) },
        householdId,
        revokedAt: null,
      },
      data: { refreshRequestedAt: now },
    });
    triggerDeviceWidgetRefresh(db, devices);
  }

  return {
    ok: true,
    targetDevices: devices.length,
  };
}
