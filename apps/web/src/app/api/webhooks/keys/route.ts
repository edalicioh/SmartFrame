import { z } from "zod";
import { getDatabase } from "@smartframe/database";
import { createWebhookKey, listWebhookKeys, revokeWebhookKey } from "@smartframe/frames";
import { administrator, frameResponse, jsonBody, privateHeaders } from "@/lib/frame-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return frameResponse(async () => {
    const owner = await administrator(request);
    const keys = await listWebhookKeys(getDatabase(), owner.householdId);
    return Response.json({ keys }, { headers: privateHeaders });
  });
}

export async function POST(request: Request) {
  return frameResponse(async () => {
    const owner = await administrator(request, true);
    const body = await jsonBody(request);
    const key = await createWebhookKey(getDatabase(), owner.householdId, owner.actorId, body);
    return Response.json({ key }, { status: 201, headers: privateHeaders });
  });
}

export async function DELETE(request: Request) {
  return frameResponse(async () => {
    const owner = await administrator(request, true);
    const queryId = new URL(request.url).searchParams.get("id");
    const id = queryId
      ? z.string().min(1).max(128).parse(queryId)
      : z
          .object({ id: z.string().min(1).max(128) })
          .strict()
          .parse(await jsonBody(request)).id;
    await revokeWebhookKey(getDatabase(), owner.householdId, owner.actorId, id);
    return Response.json({ ok: true }, { headers: privateHeaders });
  });
}
