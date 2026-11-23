import { getDatabase } from "@smartframe/database";
import { authorizeWebhook, handleWebhookRefresh } from "@smartframe/frames";
import { frameResponse, optionalJsonObject, privateHeaders } from "@/lib/frame-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return frameResponse(async () => {
    const db = getDatabase();
    const auth = await authorizeWebhook(db, request, "refresh");
    const body = await optionalJsonObject(request);
    const params = new URL(request.url).searchParams;
    const payload: Record<string, unknown> = { ...body };

    if (params.has("deviceId") && payload.deviceId === undefined) {
      payload.deviceId = params.get("deviceId");
    }
    if (params.has("panelId") && payload.panelId === undefined) {
      payload.panelId = params.get("panelId");
    }

    const result = await handleWebhookRefresh(db, auth.householdId, payload);
    return Response.json(result, { headers: privateHeaders });
  });
}
