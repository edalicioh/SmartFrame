import { z } from "zod";
import { getDatabase } from "@smartframe/database";
import { publishFrame } from "@smartframe/frames";
import { administrator, frameResponse, jsonBody, privateHeaders } from "@/lib/frame-api";

export const runtime = "nodejs";
export async function POST(request: Request) {
  return frameResponse(async () => {
    const owner = await administrator(request, true);
    const body = z
      .object({ expectedRevision: z.number().int().nonnegative() })
      .strict()
      .parse(await jsonBody(request));
    return Response.json(
      await publishFrame(getDatabase(), owner.householdId, owner.actorId, body.expectedRevision),
      { headers: privateHeaders },
    );
  });
}
