import { getDatabase } from "@smartframe/database";
import { issuePairingCode } from "@smartframe/frames";
import { administrator, frameResponse, privateHeaders } from "@/lib/frame-api";

export const runtime = "nodejs";
export async function POST(request: Request) {
  return frameResponse(async () => {
    const owner = await administrator(request, true);
    const pairing = await issuePairingCode(getDatabase(), owner.householdId, owner.actorId);
    return Response.json(
      { ...pairing, serverURL: new URL(process.env.BETTER_AUTH_URL!).origin },
      { headers: privateHeaders },
    );
  });
}
