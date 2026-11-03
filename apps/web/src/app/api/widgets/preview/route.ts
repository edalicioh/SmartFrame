import { z } from "zod";
import { photoFrameSchema } from "@smartframe/contracts";
import { getDatabase } from "@smartframe/database";
import { cachedWidgetData, refreshFrameWidgets } from "@smartframe/widgets";
import { administrator, frameResponse, jsonBody, privateHeaders } from "@/lib/frame-api";

export const runtime = "nodejs";
export async function POST(request: Request) {
  return frameResponse(async () => {
    await administrator(request, true);
    const { config } = z
      .object({ config: photoFrameSchema })
      .strict()
      .parse(await jsonBody(request));
    const db = getDatabase();
    await refreshFrameWidgets(db, config);
    return Response.json(await cachedWidgetData(db, config), { headers: privateHeaders });
  });
}
