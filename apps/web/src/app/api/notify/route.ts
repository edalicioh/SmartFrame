import { getDatabase } from "@smartframe/database";
import { authorizeWebhook, handleWebhookNotify } from "@smartframe/frames";
import { frameResponse, jsonBody, privateHeaders } from "@/lib/frame-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return frameResponse(async () => {
    const db = getDatabase();
    const auth = await authorizeWebhook(db, request, "notify");
    const body = await jsonBody(request);
    const result = await handleWebhookNotify(db, auth.householdId, body);
    return Response.json(result, { headers: privateHeaders });
  });
}
