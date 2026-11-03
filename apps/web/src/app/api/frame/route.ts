import { z } from "zod";
import { photoFrameSchema } from "@smartframe/contracts";
import { getDatabase } from "@smartframe/database";
import { frameState, saveFrame } from "@smartframe/frames";
import { administrator, frameResponse, jsonBody, privateHeaders } from "@/lib/frame-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return frameResponse(async () => {
    const owner = await administrator(request);
    return Response.json(await frameState(getDatabase(), owner.householdId), {
      headers: privateHeaders,
    });
  });
}
export async function PUT(request: Request) {
  return frameResponse(async () => {
    const owner = await administrator(request, true);
    const body = z
      .object({ config: photoFrameSchema, expectedRevision: z.number().int().nonnegative() })
      .strict()
      .parse(await jsonBody(request));
    return Response.json(
      await saveFrame(
        getDatabase(),
        owner.householdId,
        owner.actorId,
        body.config,
        body.expectedRevision,
      ),
      { headers: privateHeaders },
    );
  });
}
