import { getDatabase } from "@smartframe/database";
import { authorizePlayer, FrameError, playerManifest, readBackground } from "@smartframe/frames";
import { frameResponse, privateHeaders } from "@/lib/frame-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return frameResponse(async () => {
    const db = getDatabase();
    const device = await authorizePlayer(db, request.headers.get("authorization"));
    const { id } = await context.params;
    const manifest = await playerManifest(db, device);
    const media = manifest?.media.find((media) => media.id === id);
    if (!media) throw new FrameError(404, "Mídia não autorizada para este dispositivo.");
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
