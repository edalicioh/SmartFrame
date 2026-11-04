import { dashboardPhotoIds, onlineDashboardSchema } from "@smartframe/contracts";
import { getDatabase } from "@smartframe/database";
import { FrameError } from "@smartframe/frames";
import { z } from "zod";
import { administrator, frameResponse, jsonBody, privateHeaders } from "@/lib/frame-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return frameResponse(async () => {
    const owner = await administrator(request, true);
    const body = z
      .object({
        panelId: z.string().min(1),
        deviceId: z.string().min(1),
        expectedRevision: z.number().int().nonnegative(),
      })
      .strict()
      .parse(await jsonBody(request));
    const db = getDatabase();
    const revision = await db.$transaction(async (tx) => {
      const device = await tx.device.findFirst({
        where: { id: body.deviceId, householdId: owner.householdId, revokedAt: null },
      });
      const panel = await tx.layout.findFirst({
        where: {
          id: body.panelId,
          householdId: owner.householdId,
          OR: [{ key: { startsWith: "panel:" } }, { key: { startsWith: "online:" } }],
        },
      });
      if (!device || !panel) throw new FrameError(404, "Dispositivo ou painel não encontrado.");
      if (panel.draftRevision !== body.expectedRevision)
        throw new FrameError(409, "O painel foi alterado. Atualize e tente novamente.");
      const config = onlineDashboardSchema.parse(panel.draft ?? {});
      const ids = dashboardPhotoIds(config);
      const media = ids.length
        ? await tx.media.findMany({
            where: {
              id: { in: ids },
              householdId: owner.householdId,
              status: "ready",
              sha256: { not: null },
              bytes: { not: null },
              width: { gt: 0, lte: 4096 },
              height: { gt: 0, lte: 4096 },
            },
          })
        : [];
      if (media.filter((item) => item.width! * item.height! <= 2_097_152).length !== ids.length)
        throw new FrameError(
          400,
          "Todas as fotos selecionadas devem estar prontas, válidas e pertencer à residência.",
        );
      const version = await tx.layoutVersion.create({ data: { layoutId: panel.id, config } });
      const updated = await tx.layout.updateMany({
        where: {
          id: panel.id,
          householdId: owner.householdId,
          draftRevision: body.expectedRevision,
        },
        data: { publishedVersionId: version.id },
      });
      if (!updated.count)
        throw new FrameError(409, "O painel foi alterado. Atualize e tente novamente.");
      await tx.device.update({
        where: { id: device.id },
        data: { activePanelId: panel.id, activePanelVersionId: version.id },
      });
      return `online:${version.id}`;
    });
    return Response.json({ revision }, { headers: privateHeaders });
  });
}
