import { frameResponse, privateHeaders } from "@/lib/frame-api";
import { getDatabase } from "@smartframe/database";
import { authorizePlayer, buildPlayerControlDeckData, FrameError } from "@smartframe/frames";
import { onlineWidgetData } from "@smartframe/widgets";
import {
  evaluateScheduleNotifications,
  evaluateScheduleRules,
  filterPollSafeScheduleRules,
  readStoredOnlineDashboard,
} from "@smartframe/contracts";
import { activeOnlineVersionWithDevice } from "@/lib/active-online-version";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return frameResponse(async () => {
    const db = getDatabase();
    const authorizedDevice = await authorizePlayer(db, request.headers.get("authorization"));
    const params = new URL(request.url).searchParams;
    if (params.has("deviceId") && params.get("deviceId") !== authorizedDevice.id)
      throw new FrameError(403, "Dispositivo não autorizado.");
    const resolved = await activeOnlineVersionWithDevice(db, authorizedDevice);
    if (!resolved)
      throw new FrameError(409, "Este dispositivo ainda não possui uma configuração publicada.");
    const { device, version } = resolved;
    const revision = `online:${version.id}`;
    const config = readStoredOnlineDashboard(version.config);
    const now = new Date();
    const forceRefresh = Boolean(
      device.refreshRequestedAt && now.getTime() - device.refreshRequestedAt.getTime() < 60_000,
    );
    const pollRetentionCutoff = new Date(
      now.getTime() - Math.max(config.refreshSeconds + 30, 120) * 1000,
    );
    const [photos, activeNotifications] = await Promise.all([
      config.widgets.photos.photoIds.length
        ? db.media.findMany({
            where: {
              id: { in: config.widgets.photos.photoIds },
              householdId: device.householdId,
              status: "ready",
              sha256: { not: null },
              bytes: { not: null },
              width: { gt: 0, lte: 4096 },
              height: { gt: 0, lte: 4096 },
            },
          })
        : [],
      db.deviceNotification.findMany({
        where: {
          householdId: device.householdId,
          dismissedAt: null,
          OR: [{ deviceId: device.id }, { deviceId: null }],
          AND: [
            {
              OR: [
                { expiresAt: { gt: now } },
                ...(config.refreshSeconds > 90
                  ? [
                      {
                        createdAt: { gt: pollRetentionCutoff },
                        expiresAt: { gt: pollRetentionCutoff },
                      },
                    ]
                  : []),
              ],
            },
          ],
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 50,
      }),
    ]);
    activeNotifications.reverse();
    const byId = new Map(photos.map((photo) => [photo.id, photo]));
    const items = config.widgets.photos.photoIds.flatMap((id) => {
      const photo = byId.get(id);
      return photo && photo.width! * photo.height! <= 2_097_152
        ? [{ id, src: `/api/player/online-media/${id}?v=${photo.sha256}`, alt: photo.filename }]
        : [];
    });
    const pageEnabledWidgets = new Set(config.pages?.flatMap((page) => page.enabledWidgets) ?? []);
    const widgetSettings = {
      weather: {
        ...config.widgets.weather,
        enabled: config.widgets.weather.enabled || pageEnabledWidgets.has("weather"),
      },
      currencies: {
        ...config.widgets.currencies,
        enabled: config.widgets.currencies.enabled || pageEnabledWidgets.has("currencies"),
      },
      system: {
        ...config.widgets.system,
        enabled: config.widgets.system.enabled || pageEnabledWidgets.has("system"),
      },
      rss: {
        ...config.widgets.rss,
        enabled: config.widgets.rss.enabled || pageEnabledWidgets.has("rss"),
      },
      devMonitor: {
        ...config.widgets.devMonitor,
        enabled: config.widgets.devMonitor.enabled || pageEnabledWidgets.has("devMonitor"),
      },
    };
    const controlDeckEnabled =
      config.widgets.controlDeck.enabled || pageEnabledWidgets.has("controlDeck");
    const [baseWidgetData, controlDeckData] = await Promise.all([
      forceRefresh
        ? onlineWidgetData(db, widgetSettings, device.householdId, { forceRefresh: true })
        : onlineWidgetData(db, widgetSettings, device.householdId),
      controlDeckEnabled ? buildPlayerControlDeckData(db, device.householdId, config) : null,
    ]);
    const widgetData = controlDeckData
      ? { ...baseWidgetData, controlDeck: controlDeckData }
      : baseWidgetData;

    const effectiveTimezone = config.timezone || device.timezone;
    // Since this endpoint evaluates schedules only on poll, a narrower
    // window can begin and end between polls. Suppress those legacy rules
    // rather than silently miss an automation and preserve stored configs.
    const pollSafeRules = filterPollSafeScheduleRules(config.rules, config.refreshSeconds);
    let pageDirective:
      { id: string; pageId: string; source: "goto" | "rule"; durationSeconds: number } | undefined;
    if (
      device.targetPageId &&
      device.targetPageNonce &&
      (!device.targetPageExpiresAt || device.targetPageExpiresAt > now) &&
      config.pages?.length &&
      (((device.targetPageId === "next" || device.targetPageId === "prev") &&
        config.pages.length > 1) ||
        config.pages.some((page) => page.id === device.targetPageId))
    ) {
      pageDirective = {
        id: `goto:${device.targetPageNonce}`,
        pageId: device.targetPageId,
        source: "goto",
        durationSeconds: device.targetPageDuration ?? 0,
      };
    } else if (pollSafeRules?.length && config.pages?.length) {
      const match = evaluateScheduleRules(pollSafeRules, now, effectiveTimezone);
      if (match && config.pages.some((page) => page.id === match.pageId)) {
        pageDirective = {
          id: match.directiveId,
          pageId: match.pageId,
          source: "rule",
          durationSeconds: match.durationSeconds,
        };
      }
    }

    const scheduledNotifications = pollSafeRules?.length
      ? evaluateScheduleNotifications(pollSafeRules, now, effectiveTimezone)
      : [];

    const notifications = [
      ...activeNotifications.map((item) => ({
        id: item.id,
        title: item.title,
        message: item.message,
        severity: item.severity,
        durationSeconds: item.durationSeconds,
        createdAt: item.createdAt.toISOString(),
      })),
      ...scheduledNotifications.map((item) => ({
        id: item.id,
        title: item.title,
        message: item.message,
        severity: item.severity,
        durationSeconds: item.durationSeconds,
        createdAt: now.toISOString(),
      })),
    ];

    const result = {
      ...config,
      deviceId: device.id,
      revision,
      widgets: { ...config.widgets, photos: { ...config.widgets.photos, items } },
      widgetData,
      ...(notifications.length > 0 ? { notifications } : {}),
      ...(pageDirective ? { pageDirective } : {}),
    };
    if (Buffer.byteLength(JSON.stringify(result), "utf8") > 1024 * 1024)
      throw new FrameError(413, "Configuração e widgets excedem o limite de 1 MiB.");
    const applied = params.get("appliedRevision");
    if (applied && applied === revision)
      await db.device.updateMany({
        where: {
          id: device.id,
          tokenHash: device.tokenHash,
          revokedAt: null,
          activePanelId: device.activePanelId,
          activePanelVersionId: device.activePanelVersionId,
        },
        data: { appliedRevision: revision },
      });
    await db.device.updateMany({
      where: { id: device.id, tokenHash: device.tokenHash, revokedAt: null },
      data: { lastSeenAt: now },
    });
    if (forceRefresh && device.refreshRequestedAt) {
      await db.device.updateMany({
        where: {
          id: device.id,
          tokenHash: device.tokenHash,
          revokedAt: null,
          refreshRequestedAt: device.refreshRequestedAt,
        },
        data: { refreshRequestedAt: null },
      });
    }
    return Response.json(result, { headers: privateHeaders });
  });
}
