import { getDatabase } from "@smartframe/database";
import { administrator, frameResponse, privateHeaders } from "@/lib/frame-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const deviceSelect = {
  id: true,
  name: true,
  timezone: true,
  lastSeenAt: true,
  appliedRevision: true,
  activePanelId: true,
  activePanelVersionId: true,
  createdAt: true,
} as const;

export async function GET(request: Request) {
  return frameResponse(async () => {
    const owner = await administrator(request);
    const database = getDatabase();
    const includeId = new URL(request.url).searchParams.get("includeId")?.trim() || null;
    const devices = await database.device.findMany({
      where: { householdId: owner.householdId, revokedAt: null },
      select: deviceSelect,
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    if (includeId && !devices.some((device) => device.id === includeId)) {
      const requestedDevice = await database.device.findFirst({
        where: { id: includeId, householdId: owner.householdId, revokedAt: null },
        select: deviceSelect,
      });
      if (requestedDevice) {
        devices.push(requestedDevice);
      }
    }
    return Response.json({ data: devices }, { headers: privateHeaders });
  });
}
