import { getDatabase } from "@smartframe/database";
import { z } from "zod";
import { administrator, frameResponse, jsonBody, privateHeaders } from "@/lib/frame-api";
import { publishOnlinePanel } from "@/lib/publish-online-panel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  return frameResponse(async () => {
    const owner = await administrator(request, true);
    const { deviceId, expectedRevision } = z
      .object({ deviceId: z.string().min(1), expectedRevision: z.number().int().nonnegative() })
      .strict()
      .parse(await jsonBody(request));
    const revision = await publishOnlinePanel(getDatabase(), {
      householdId: owner.householdId,
      deviceId,
      expectedRevision,
      legacy: true,
    });
    return Response.json({ revision }, { headers: privateHeaders });
  });
}
