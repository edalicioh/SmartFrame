import { frameResponse, privateHeaders } from "@/lib/frame-api";
import { getDatabase } from "@smartframe/database";
import { authorizePlayer, FrameError } from "@smartframe/frames";
import { onlineWidgetData } from "@smartframe/widgets";
import { onlineDashboardSchema } from "@smartframe/contracts";
import { activeOnlineVersion } from "@/lib/active-online-version";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return frameResponse(async () => {
    const db = getDatabase();
    const device = await authorizePlayer(db, request.headers.get("authorization"));
    const params = new URL(request.url).searchParams;
    if (params.has("deviceId") && params.get("deviceId") !== device.id)
      throw new FrameError(403, "Dispositivo não autorizado.");
    const version = await activeOnlineVersion(db, device);
    if (!version)
      throw new FrameError(409, "Este dispositivo ainda não possui uma configuração publicada.");
    const revision = `online:${version.id}`;
    const config = onlineDashboardSchema.parse(version.config);
    const photos = config.widgets.photos.photoIds.length
      ? await db.media.findMany({
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
      : [];
    const byId = new Map(photos.map((photo) => [photo.id, photo]));
    const items = config.widgets.photos.photoIds.flatMap((id) => {
      const photo = byId.get(id);
      return photo && photo.width! * photo.height! <= 2_097_152
        ? [{ id, src: `/api/player/online-media/${id}?v=${photo.sha256}`, alt: photo.filename }]
        : [];
    });
    const widgetData = await onlineWidgetData(db, config.widgets);
    const result = {
      ...config,
      deviceId: device.id,
      revision,
      widgets: { ...config.widgets, photos: { ...config.widgets.photos, items } },
      widgetData,
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
      data: { lastSeenAt: new Date() },
    });
    return Response.json(result, { headers: privateHeaders });
  });
}
