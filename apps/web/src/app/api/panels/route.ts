import { randomUUID } from "node:crypto";
import { onlineDashboardSchema } from "@smartframe/contracts";
import { getDatabase } from "@smartframe/database";
import { FrameError } from "@smartframe/frames";
import { z } from "zod";
import { administrator, frameResponse, jsonBody, privateHeaders } from "@/lib/frame-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const name = z.string().trim().min(1).max(80);
const panelWhere = (householdId: string) => ({
  householdId,
  OR: [{ key: { startsWith: "panel:" } }, { key: { startsWith: "online:" } }],
});

export async function GET(request: Request) {
  return frameResponse(async () => {
    const owner = await administrator(request);
    const db = getDatabase();
    const id = new URL(request.url).searchParams.get("id");
    if (id) {
      const panel = await db.layout.findFirst({ where: { ...panelWhere(owner.householdId), id } });
      if (!panel) throw new FrameError(404, "Painel não encontrado.");
      return Response.json(
        {
          id: panel.id,
          name: panel.name,
          config: onlineDashboardSchema.parse(panel.draft ?? {}),
          draftRevision: panel.draftRevision,
        },
        { headers: privateHeaders },
      );
    }
    const panels = await db.layout.findMany({
      where: panelWhere(owner.householdId),
      select: { id: true, name: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    return Response.json({ panels }, { headers: privateHeaders });
  });
}

export async function POST(request: Request) {
  return frameResponse(async () => {
    const owner = await administrator(request, true);
    const body = z
      .object({ name, copyFromId: z.string().min(1).optional() })
      .strict()
      .parse(await jsonBody(request));
    const db = getDatabase();
    const source = body.copyFromId
      ? await db.layout.findFirst({
          where: { ...panelWhere(owner.householdId), id: body.copyFromId },
        })
      : null;
    if (body.copyFromId && !source) throw new FrameError(404, "Painel não encontrado.");
    const panel = await db.layout.create({
      data: {
        householdId: owner.householdId,
        key: `panel:${randomUUID()}`,
        name: body.name,
        draft: onlineDashboardSchema.parse(source?.draft ?? {}),
        draftRevision: 1,
      },
    });
    return Response.json(
      { id: panel.id, name: panel.name },
      { status: 201, headers: privateHeaders },
    );
  });
}

export async function PUT(request: Request) {
  return frameResponse(async () => {
    const owner = await administrator(request, true);
    const body = z
      .object({
        id: z.string().min(1),
        expectedRevision: z.number().int().nonnegative(),
        config: onlineDashboardSchema,
      })
      .strict()
      .parse(await jsonBody(request));
    const changed = await getDatabase().layout.updateMany({
      where: {
        ...panelWhere(owner.householdId),
        id: body.id,
        draftRevision: body.expectedRevision,
      },
      data: { draft: body.config, draftRevision: { increment: 1 } },
    });
    if (!changed.count)
      throw new FrameError(409, "Painel alterado ou não encontrado. Atualize e tente novamente.");
    return Response.json({ draftRevision: body.expectedRevision + 1 }, { headers: privateHeaders });
  });
}

export async function PATCH(request: Request) {
  return frameResponse(async () => {
    const owner = await administrator(request, true);
    const body = z
      .object({ id: z.string().min(1), name })
      .strict()
      .parse(await jsonBody(request));
    const changed = await getDatabase().layout.updateMany({
      where: { ...panelWhere(owner.householdId), id: body.id },
      data: { name: body.name },
    });
    if (!changed.count) throw new FrameError(404, "Painel não encontrado.");
    return Response.json({ ok: true }, { headers: privateHeaders });
  });
}

export async function DELETE(request: Request) {
  return frameResponse(async () => {
    const owner = await administrator(request, true);
    const body = z
      .object({ id: z.string().min(1) })
      .strict()
      .parse(await jsonBody(request));
    const db = getDatabase();
    await db.$transaction(async (tx) => {
      const panel = await tx.layout.findFirst({
        where: { ...panelWhere(owner.householdId), id: body.id },
      });
      if (!panel) throw new FrameError(404, "Painel não encontrado.");
      if (await tx.device.count({ where: { activePanelId: panel.id, revokedAt: null } }))
        throw new FrameError(
          409,
          "Este painel está em uso. Escolha outro painel para os dispositivos antes de excluí-lo.",
        );
      // Revoked devices should not prevent deletion or retain references.
      await tx.device.updateMany({
        where: { activePanelId: panel.id },
        data: { activePanelId: null, activePanelVersionId: null },
      });
      await tx.layout.delete({ where: { id: panel.id } });
    });
    return Response.json({ ok: true }, { headers: privateHeaders });
  });
}
