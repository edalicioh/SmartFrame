import { getDatabase } from "@smartframe/database";
import { authorizeWebhook, handleWebhookGoto } from "@smartframe/frames";
import { frameResponse, optionalJsonObject, privateHeaders } from "@/lib/frame-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ page: string }> }) {
  return frameResponse(async () => {
    const db = getDatabase();
    const auth = await authorizeWebhook(db, request, "goto");
    const { page } = await context.params;
    const body = await optionalJsonObject(request);
    const params = new URL(request.url).searchParams;
    const payload: Record<string, unknown> = { ...body };

    if (params.has("deviceId") && payload.deviceId === undefined) {
      payload.deviceId = params.get("deviceId");
    }
    if (params.has("panelId") && payload.panelId === undefined) {
      payload.panelId = params.get("panelId");
    }
    if (params.has("refresh") && payload.refresh === undefined) {
      const value = params.get("refresh");
      payload.refresh =
        value === "true" || value === "1"
          ? true
          : value === "false" || value === "0"
            ? false
            : value;
    }
    if (params.has("durationSeconds") && payload.durationSeconds === undefined) {
      const value = params.get("durationSeconds") ?? "";
      payload.durationSeconds = /^-?\d+$/.test(value) ? Number(value) : value;
    }

    const result = await handleWebhookGoto(db, auth.householdId, page, payload);
    return Response.json(result, { headers: privateHeaders });
  });
}
