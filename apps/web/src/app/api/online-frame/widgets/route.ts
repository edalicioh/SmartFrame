import { onlineDashboardSchema } from "@smartframe/contracts";
import { getDatabase } from "@smartframe/database";
import { onlineWidgetData } from "@smartframe/widgets";
import { administrator, frameResponse, jsonBody, privateHeaders } from "@/lib/frame-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Session-only preview data. Never exposes the device's bearer to the browser. */
export async function POST(request: Request) {
  return frameResponse(async () => {
    await administrator(request, true);
    const config = onlineDashboardSchema.parse(await jsonBody(request));
    const db = getDatabase();
    return Response.json(await onlineWidgetData(db, config.widgets), { headers: privateHeaders });
  });
}
