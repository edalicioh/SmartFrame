import { onlineDashboardSchema } from "@smartframe/contracts";
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
    if (!deviceId) throw new FrameError(400, "deviceId obrigatório.");
    const db = getDatabase();
    const device = await db.device.findFirst({
      where: { id: deviceId, householdId: owner.householdId, revokedAt: null },
    });
    if (!device) throw new FrameError(404, "Dispositivo não encontrado.");
    const layout = await db.layout.findUnique({
      where: { key: `online:${device.id}` },
      include: { publishedVersion: true },
    });
    return Response.json(
      {
        deviceId,
        config: onlineDashboardSchema.parse(layout?.draft ?? {}),
        draftRevision: layout?.draftRevision ?? 0,
        publishedRevision: layout?.publishedVersionId
          ? `online:${layout.publishedVersionId}`
          : null,
        appliedRevision: device.appliedRevision?.startsWith("online:")
          ? device.appliedRevision
          : null,
        lastSeenAt: device.lastSeenAt,
      },
      { headers: privateHeaders },
    );
  });
}

export async function PUT(request: Request) {
  return frameResponse(async () => {
    const owner = await administrator(request, true);
    const body = z
      .object({
        deviceId: z.string().min(1),
        config: onlineDashboardSchema,
        expectedRevision: z.number().int().nonnegative(),
      })
      .strict()
      .parse(await jsonBody(request));
    const db = getDatabase();
    const device = await db.device.findFirst({
      where: { id: body.deviceId, householdId: owner.householdId, revokedAt: null },
    });
    if (!device) throw new FrameError(404, "Dispositivo não encontrado.");
    const key = `online:${device.id}`;
    let layout = await db.layout.findUnique({ where: { key } });
    if (!layout) {
      if (body.expectedRevision !== 0)
        throw new FrameError(409, "A configuração foi alterada. Atualize e tente novamente.");
      layout = await db.layout.create({
        data: {
          key,
          householdId: owner.householdId,
          name: `Online ${device.name}`,
          draft: body.config,
          draftRevision: 1,
        },
      });
      return Response.json({ draftRevision: 1 }, { headers: privateHeaders });
    }
    const changed = await db.layout.updateMany({
      where: {
        id: layout.id,
        householdId: owner.householdId,
        draftRevision: body.expectedRevision,
      },
      data: { draft: body.config, draftRevision: { increment: 1 } },
    });
    if (!changed.count)
      throw new FrameError(409, "A configuração foi alterada. Atualize e tente novamente.");
    return Response.json({ draftRevision: body.expectedRevision + 1 }, { headers: privateHeaders });
  });
}
