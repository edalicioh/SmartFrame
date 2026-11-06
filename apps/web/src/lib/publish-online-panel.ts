import "server-only";
import { dashboardPhotoIds, onlineDashboardSchema } from "@smartframe/contracts";
import type { PrismaClient } from "@smartframe/database";
import { FrameError } from "@smartframe/frames";

type Publication = {
  householdId: string;
  deviceId: string;
  expectedRevision: number;
} & ({ panelId: string; activate: boolean } | { legacy: true });

/** Keep the publication, per-device approval and optional activation atomic in both APIs. */
export async function publishOnlinePanel(db: PrismaClient, input: Publication) {
  return db.$transaction(async (tx) => {
    const device = await tx.device.findFirst({
      where: { id: input.deviceId, householdId: input.householdId, revokedAt: null },
    });
    const panel = await tx.layout.findFirst({
      where: {
        householdId: input.householdId,
        ...("legacy" in input
          ? { key: `online:${input.deviceId}` }
          : {
              id: input.panelId,
              OR: [{ key: { startsWith: "panel:" } }, { key: { startsWith: "online:" } }],
            }),
      },
    });
    if (!device || !panel) throw new FrameError(404, "Dispositivo ou painel não encontrado.");
    if (panel.draftRevision !== input.expectedRevision)
      throw new FrameError(409, "O painel foi alterado. Atualize e tente novamente.");
    const config = onlineDashboardSchema.parse(panel.draft ?? {});
    const ids = dashboardPhotoIds(config);
    const media = ids.length
      ? await tx.media.findMany({
          where: {
            id: { in: ids },
            householdId: input.householdId,
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
        householdId: input.householdId,
        draftRevision: input.expectedRevision,
      },
      data: { publishedVersionId: version.id },
    });
    if (!updated.count)
      throw new FrameError(409, "O painel foi alterado. Atualize e tente novamente.");
    await tx.devicePanelAccess.upsert({
      where: { deviceId_panelId: { deviceId: device.id, panelId: panel.id } },
      create: { deviceId: device.id, panelId: panel.id, versionId: version.id },
      update: { versionId: version.id },
    });
    // Compatibility publishing must not replace a different panel chosen in the new editor.
    const activate =
      "legacy" in input
        ? device.activePanelId === null || device.activePanelId === panel.id
        : input.activate;
    if (activate)
      await tx.device.update({
        where: { id: device.id },
        data: { activePanelId: panel.id, activePanelVersionId: version.id },
      });
    return `online:${version.id}`;
  });
}
