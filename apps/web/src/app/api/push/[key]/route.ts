import { getDatabase } from "@smartframe/database";
import { authorizeWebhook, handleWebhookPush } from "@smartframe/frames";
import { frameResponse, jsonBody, privateHeaders } from "@/lib/frame-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ key: string }> }) {
  return frameResponse(async () => {
    const db = getDatabase();
    const auth = await authorizeWebhook(db, request, "push");
    const { key } = await context.params;
    const body = await jsonBody(request);
    const result = await handleWebhookPush(db, auth.householdId, key, body);
    return Response.json(result, { headers: privateHeaders });
  });
}
