import { webhookTestPayloadSchema } from "@smartframe/contracts";
import { getDatabase } from "@smartframe/database";
import {
  handleWebhookGoto,
  handleWebhookNotify,
  handleWebhookPush,
  handleWebhookRefresh,
} from "@smartframe/frames";
import { administrator, frameResponse, jsonBody, privateHeaders } from "@/lib/frame-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return frameResponse(async () => {
    const owner = await administrator(request, true);
    const parsed = webhookTestPayloadSchema.parse(await jsonBody(request));
    const db = getDatabase();

    if (parsed.action === "notify") {
      return Response.json(
        await handleWebhookNotify(db, owner.householdId, {
          title: parsed.title,
          message: parsed.message,
          severity: parsed.severity,
          durationSeconds: parsed.durationSeconds,
          deviceId: parsed.deviceId,
          panelId: parsed.panelId,
        }),
        { headers: privateHeaders },
      );
    }
    if (parsed.action === "goto") {
      return Response.json(
        await handleWebhookGoto(db, owner.householdId, parsed.page, {
          deviceId: parsed.deviceId,
          panelId: parsed.panelId,
          durationSeconds: parsed.durationSeconds,
          refresh: parsed.refresh,
        }),
        { headers: privateHeaders },
      );
    }
    if (parsed.action === "push") {
      return Response.json(
        await handleWebhookPush(db, owner.householdId, parsed.key, {
          name: parsed.name,
          title: parsed.title,
          category: parsed.category,
          status: parsed.status,
          detail: parsed.detail,
          text: parsed.text,
          value: parsed.value,
          ttlSeconds: parsed.ttlSeconds,
        }),
        { headers: privateHeaders },
      );
    }
    return Response.json(
      await handleWebhookRefresh(db, owner.householdId, {
        deviceId: parsed.deviceId,
        panelId: parsed.panelId,
      }),
      { headers: privateHeaders },
    );
  });
}
