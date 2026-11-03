import { frameResponse, privateHeaders } from "@/lib/frame-api";
import { getDatabase } from "@smartframe/database";
import { authorizePlayer, FrameError } from "@smartframe/frames";
import { onlineWidgetData } from "@smartframe/widgets";
import { createHash } from "node:crypto";
import { onlineDashboardSchema } from "@smartframe/contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return frameResponse(async () => {
    const db = getDatabase();
    const device = await authorizePlayer(db, request.headers.get("authorization"));
    const params = new URL(request.url).searchParams;
    if (params.has("deviceId") && params.get("deviceId") !== device.id) throw new FrameError(403, "Dispositivo não autorizado.");
    const layout = await db.layout.findUnique({ where: { key: `online:${device.id}` }, include: { publishedVersion: true } });
    if (!layout?.publishedVersion) throw new FrameError(409, "Este dispositivo ainda não possui uma configuração publicada.");
    const revision = `online:${layout.publishedVersion.id}`;
    const config = onlineDashboardSchema.parse(layout.publishedVersion.config);
    const photos = config.widgets.photos.photoIds.length ? await db.media.findMany({ where: { id: { in: config.widgets.photos.photoIds }, householdId: device.householdId, status: "ready" } }) : [];
    const byId = new Map(photos.map((photo) => [photo.id, photo]));
    const items = config.widgets.photos.photoIds.flatMap((id) => { const photo = byId.get(id); return photo ? [{ id, src: `/api/player/online-media/${id}?v=${photo.sha256 ?? createHash("sha256").update(id).digest("hex")}`, alt: photo.filename }] : []; });
    const widgetData = await onlineWidgetData(db, config.widgets);
    const result = { ...config, deviceId: device.id, revision, widgets: { ...config.widgets, photos: { ...config.widgets.photos, items } }, widgetData };
    if (Buffer.byteLength(JSON.stringify(result), "utf8") > 1024 * 1024) throw new FrameError(413, "Configuração e widgets excedem o limite de 1 MiB.");
    const applied = params.get("appliedRevision");
    if (applied && applied === revision) await db.device.updateMany({ where: { id: device.id, tokenHash: device.tokenHash, revokedAt: null }, data: { appliedRevision: revision } });
    await db.device.updateMany({ where: { id: device.id, tokenHash: device.tokenHash, revokedAt: null }, data: { lastSeenAt: new Date() } });
    return Response.json(result, { headers: privateHeaders });
  });
}
