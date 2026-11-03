import { FrameError } from "@smartframe/frames";
import { frameResponse, privateHeaders } from "@/lib/frame-api";
import { authorizeOnlinePlayer } from "@/lib/online-player-access";
import { onlinePaths, readOnlinePhoto } from "@/lib/online-player";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return frameResponse(async () => {
    await authorizeOnlinePlayer(request);
    const photo = await readOnlinePhoto(onlinePaths().photos, (await context.params).id);
    if (!photo) throw new FrameError(404, "Foto não disponível.");
    return new Response(new Uint8Array(photo.bytes), {
      headers: {
        ...privateHeaders,
        "Content-Type": photo.type,
        "Content-Length": String(photo.bytes.length),
        "X-Content-Type-Options": "nosniff",
        ETag: `"${photo.digest}"`,
      },
    });
  });
}
