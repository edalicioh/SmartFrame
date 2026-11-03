import { getDatabase } from "@smartframe/database";
import { authorizePlayer, FrameError, readBackground } from "@smartframe/frames";
import { frameResponse, privateHeaders } from "@/lib/frame-api";
import { onlineDashboardSchema } from "@smartframe/contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return frameResponse(async () => {
    const db = getDatabase();
    const device = await authorizePlayer(db, request.headers.get("authorization"));
    const { id } = await context.params;
    const layout = await db.layout.findUnique({ where: { key: `online:${device.id}` }, include: { publishedVersion: true } });
    if (!layout?.publishedVersion) throw new FrameError(404, "Mídia não autorizada.");
    const config = onlineDashboardSchema.parse(layout.publishedVersion.config);
    if (!config.widgets.photos.photoIds.includes(id)) throw new FrameError(404, "Mídia não autorizada.");
    const media = await db.media.findFirst({ where: { id, householdId: device.householdId, status: "ready" } });
    if (!media) throw new FrameError(404, "Mídia não autorizada.");
    return new Response(new Uint8Array(await readBackground(id)), { headers: { ...privateHeaders, "Content-Type": "image/webp", "Content-Length": String(media.bytes), ETag: `"${media.sha256}"`, "X-Content-Type-Options": "nosniff" } });
  });
}
