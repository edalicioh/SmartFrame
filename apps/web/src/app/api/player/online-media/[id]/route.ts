import { getDatabase } from "@smartframe/database";
import { authorizePlayer, FrameError, readBackground } from "@smartframe/frames";
import { frameResponse, privateHeaders } from "@/lib/frame-api";
import { dashboardPhotoIds, onlineDashboardSchema } from "@smartframe/contracts";
import { activeOnlineVersion } from "@/lib/active-online-version";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return frameResponse(async () => {
    const db = getDatabase();
    const device = await authorizePlayer(db, request.headers.get("authorization"));
    const { id } = await context.params;
    const version = await activeOnlineVersion(db, device);
    if (!version) throw new FrameError(404, "Mídia não autorizada.");
    const config = onlineDashboardSchema.parse(version.config);
    if (!dashboardPhotoIds(config).includes(id))
      throw new FrameError(404, "Mídia não autorizada.");
    const media = await db.media.findFirst({
      where: {
        id,
        householdId: device.householdId,
        status: "ready",
        sha256: { not: null },
        bytes: { not: null },
        width: { gt: 0, lte: 4096 },
        height: { gt: 0, lte: 4096 },
      },
    });
    if (!media || media.width! * media.height! > 2_097_152)
      throw new FrameError(404, "Mídia não autorizada.");
    return new Response(new Uint8Array(await readBackground(id)), {
      headers: {
        ...privateHeaders,
        "Content-Type": "image/webp",
        "Content-Length": String(media.bytes),
        ETag: `"${media.sha256}"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
