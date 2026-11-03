import { getDatabase } from "@smartframe/database";
import { FrameError, readBackground } from "@smartframe/frames";
import { administrator, frameResponse, privateHeaders } from "@/lib/frame-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return frameResponse(async () => {
    const owner = await administrator(request);
    const { id } = await context.params;
    if (
      !(await getDatabase().media.findFirst({
        where: { id, householdId: owner.householdId, status: "ready" },
      }))
    )
      throw new FrameError(404, "Foto não disponível.");
    return new Response(new Uint8Array(await readBackground(id)), {
      headers: {
        ...privateHeaders,
        "Content-Type": "image/webp",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
