import { getDatabase } from "@smartframe/database";
import { FrameError } from "@smartframe/frames";
import { administrator, frameResponse, privateHeaders } from "@/lib/frame-api";

export const runtime = "nodejs";
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  return frameResponse(async () => {
    const owner = await administrator(request, true);
    const { id } = await context.params;
    const db = getDatabase();
    await db.$transaction(async (tx) => {
      const revoked = await tx.device.updateMany({
        where: { id, householdId: owner.householdId, revokedAt: null },
        data: { revokedAt: new Date(), tokenHash: null },
      });
      if (!revoked.count) throw new FrameError(404, "Dispositivo não encontrado.");
      await tx.auditLog.create({
        data: { householdId: owner.householdId, actorId: owner.actorId, action: "device.revoked" },
      });
    });
    return Response.json({ ok: true }, { headers: privateHeaders });
  });
}
