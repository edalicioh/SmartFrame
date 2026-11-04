import { getDatabase } from "@smartframe/database";
import { administrator, frameResponse, privateHeaders } from "@/lib/frame-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return frameResponse(async () => {
    const owner = await administrator(request);
    const database = getDatabase();
    const devices = await database.device.findMany({
      where: { householdId: owner.householdId, revokedAt: null },
      select: {
        id: true,
        name: true,
        timezone: true,
        lastSeenAt: true,
        appliedRevision: true,
        activePanelId: true,
        activePanelVersionId: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return Response.json({ data: devices }, { headers: privateHeaders });
  });
}
