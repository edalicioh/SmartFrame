import { unavailableControlDeckHostStatus } from "@smartframe/contracts";
import {
  fetchControlDeckAgentStatus,
  isControlDeckHostAuthorizedForHousehold,
} from "@smartframe/frames";
import { administrator, frameResponse, privateHeaders } from "@/lib/frame-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return frameResponse(async () => {
    const owner = await administrator(request);
    if (!isControlDeckHostAuthorizedForHousehold(owner.householdId)) {
      return Response.json(
        {
          configured: false,
          reachable: false,
          status: unavailableControlDeckHostStatus(),
        },
        { headers: privateHeaders },
      );
    }
    const status = await fetchControlDeckAgentStatus();
    return Response.json(status, { headers: privateHeaders });
  });
}
