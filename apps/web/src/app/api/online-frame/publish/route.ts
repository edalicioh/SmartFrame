import { onlineDashboardSchema } from "@smartframe/contracts";
import { getDatabase } from "@smartframe/database";
import { FrameError } from "@smartframe/frames";
import { z } from "zod";
import { administrator, frameResponse, jsonBody, privateHeaders } from "@/lib/frame-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  return frameResponse(async () => {
    const owner = await administrator(request, true);
    const { deviceId, expectedRevision } = z.object({ deviceId: z.string().min(1), expectedRevision: z.number().int().nonnegative() }).strict().parse(await jsonBody(request));
    const db = getDatabase();
    const device = await db.device.findFirst({ where: { id: deviceId, householdId: owner.householdId, revokedAt: null } });
    const layout = await db.layout.findUnique({ where: { key: `online:${deviceId}` } });
    if (!device || !layout || layout.householdId !== owner.householdId) throw new FrameError(404, "Dispositivo ou configuração não encontrado.");
    if (layout.draftRevision !== expectedRevision) throw new FrameError(409, "A configuração foi alterada. Atualize e tente novamente.");
    const config = onlineDashboardSchema.parse(layout.draft ?? {});
    const ids = config.widgets.photos.photoIds;
    const media = ids.length ? await db.media.findMany({ where: { id: { in: ids }, householdId: owner.householdId, status: "ready", sha256: { not: null }, bytes: { not: null }, width: { gt: 0, lte: 4096 }, height: { gt: 0, lte: 4096 } } }) : [];
    const usable = media.filter((item) => item.width! * item.height! <= 2_097_152);
    if (usable.length !== ids.length) throw new FrameError(400, "Todas as fotos selecionadas devem estar prontas, válidas e pertencer à residência.");
    const version = await db.layoutVersion.create({ data: { layoutId: layout.id, config } });
    const updated = await db.layout.updateMany({ where: { id: layout.id, householdId: owner.householdId, draftRevision: expectedRevision }, data: { publishedVersionId: version.id } });
    if (!updated.count) throw new FrameError(409, "A configuração foi alterada. Atualize e tente novamente.");
    return Response.json({ revision: `online:${version.id}` }, { headers: privateHeaders });
  });
}
