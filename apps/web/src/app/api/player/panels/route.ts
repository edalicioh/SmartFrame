import { getDatabase } from "@smartframe/database";
import { authorizePlayer, FrameError } from "@smartframe/frames";
import { z } from "zod";
import { frameResponse, jsonBody, privateHeaders } from "@/lib/frame-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return frameResponse(async () => {
    const db = getDatabase();
    const device = await authorizePlayer(db, request.headers.get("authorization"));
    const entries = await db.devicePanelAccess.findMany({
      where: {
        deviceId: device.id,
        panel: { householdId: device.householdId },
        version: { layout: { householdId: device.householdId } },
      },
      include: { panel: true, version: true },
      orderBy: { panel: { name: "asc" } },
    });
    const panels = entries
      .filter((entry) => entry.version.layoutId === entry.panelId)
      .map((entry) => ({
        id: entry.panelId,
        name: entry.panel.name,
        current: entry.panelId === device.activePanelId,
        updateAvailable:
          entry.panelId === device.activePanelId && entry.versionId !== device.activePanelVersionId,
        applied:
          entry.panelId === device.activePanelId &&
          device.appliedRevision === `online:${device.activePanelVersionId}`,
      }));
    return Response.json(
      {
        panels,
        activePanelId: device.activePanelId,
        revision: device.activePanelVersionId ? `online:${device.activePanelVersionId}` : null,
        appliedRevision: device.appliedRevision,
      },
      { headers: privateHeaders },
    );
  });
}

export async function POST(request: Request) {
  return frameResponse(async () => {
    const db = getDatabase();
    const device = await authorizePlayer(db, request.headers.get("authorization"));
    const { panelId } = z
      .object({ panelId: z.string().min(1).max(128) })
      .strict()
      .parse(await jsonBody(request));
    const revision = await db.$transaction(async (tx) => {
      const current = await tx.device.findFirst({
        where: { id: device.id, tokenHash: device.tokenHash, revokedAt: null },
      });
      if (!current) throw new FrameError(401, "Dispositivo não autorizado.");
      const access = await tx.devicePanelAccess.findFirst({
        where: { deviceId: current.id, panelId, panel: { householdId: current.householdId } },
        include: { version: true },
      });
      if (!access || access.version.layoutId !== panelId)
        throw new FrameError(404, "Painel não disponível.");
      await tx.device.update({
        where: { id: current.id },
        data: {
          activePanelId: panelId,
          activePanelVersionId: access.versionId,
          ...(current.activePanelId !== panelId || current.activePanelVersionId !== access.versionId
            ? { appliedRevision: null }
            : {}),
        },
      });
      return `online:${access.versionId}`;
    });
    return Response.json({ revision }, { headers: privateHeaders });
  });
}
