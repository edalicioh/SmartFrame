import { getDatabase } from "@smartframe/database";
import { FrameError } from "@smartframe/frames";
import { z } from "zod";
import { administrator, frameResponse, jsonBody, privateHeaders } from "@/lib/frame-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return frameResponse(async () => {
    const owner = await administrator(request);
    const deviceId = new URL(request.url).searchParams.get("deviceId");
    const db = getDatabase();
    const device = await db.device.findFirst({
      where: { id: deviceId ?? "", householdId: owner.householdId, revokedAt: null },
    });
    if (!device) throw new FrameError(404, "Dispositivo não encontrado.");
    const access = await db.devicePanelAccess.findMany({
      where: { deviceId: device.id, panel: { householdId: owner.householdId } },
      select: { panelId: true, versionId: true },
    });
    return Response.json({ access }, { headers: privateHeaders });
  });
}

export async function DELETE(request: Request) {
  return frameResponse(async () => {
    const owner = await administrator(request, true);
    const body = z
      .object({ deviceId: z.string().min(1).max(128), panelId: z.string().min(1).max(128) })
      .strict()
      .parse(await jsonBody(request));
    const db = getDatabase();
    await db.$transaction(async (tx) => {
      const device = await tx.device.findFirst({
        where: { id: body.deviceId, householdId: owner.householdId, revokedAt: null },
      });
      if (!device) throw new FrameError(404, "Dispositivo não encontrado.");
      if (device.activePanelId === body.panelId)
        throw new FrameError(
          409,
          "Publique outro painel no dispositivo antes de remover o painel atual.",
        );
      await tx.devicePanelAccess.deleteMany({
        where: {
          deviceId: device.id,
          panelId: body.panelId,
          panel: { householdId: owner.householdId },
        },
      });
    });
    return Response.json({ ok: true }, { headers: privateHeaders });
  });
}
