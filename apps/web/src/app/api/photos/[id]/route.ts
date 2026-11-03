import { getDatabase } from "@smartframe/database";
import { FrameError } from "@smartframe/frames";
import { administrator, frameResponse, privateHeaders } from "@/lib/frame-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return frameResponse(async () => {
    const owner = await administrator(request);
    const { id } = await context.params;
    const photo = await getDatabase().media.findFirst({
      where: { id, householdId: owner.householdId },
      select: { id: true, status: true, filename: true },
    });
    if (!photo) throw new FrameError(404, "Foto não encontrada.");
    return Response.json(photo, { headers: privateHeaders });
  });
}
