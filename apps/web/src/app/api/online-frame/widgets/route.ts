import { onlineDashboardSchema } from "@smartframe/contracts";
import { getDatabase } from "@smartframe/database";
import { buildPlayerControlDeckData } from "@smartframe/frames";
import { onlineWidgetData } from "@smartframe/widgets";
import { administrator, frameResponse, jsonBody, privateHeaders } from "@/lib/frame-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Session-only preview data. Never exposes the device's bearer to the browser. */
export async function POST(request: Request) {
  return frameResponse(async () => {
    const { householdId } = await administrator(request, true);
    const config = onlineDashboardSchema.parse(await jsonBody(request));
    const db = getDatabase();
    const pageEnabledWidgets = new Set(config.pages?.flatMap((page) => page.enabledWidgets) ?? []);
    const controlDeckEnabled =
      config.widgets.controlDeck.enabled || pageEnabledWidgets.has("controlDeck");
    const [widgetData, controlDeckData] = await Promise.all([
      onlineWidgetData(db, config.widgets, householdId),
      controlDeckEnabled ? buildPlayerControlDeckData(db, householdId, config) : null,
    ]);
    return Response.json(
      controlDeckData ? { ...widgetData, controlDeck: controlDeckData } : widgetData,
      { headers: privateHeaders },
    );
  });
}
