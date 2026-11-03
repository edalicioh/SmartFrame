import { z } from "zod";
import { getDatabase } from "@smartframe/database";
import { acknowledgeFrame, authorizePlayer } from "@smartframe/frames";
import { frameResponse, jsonBody, privateHeaders } from "@/lib/frame-api";

export const runtime = "nodejs";
export async function POST(request: Request) {
  return frameResponse(async () => {
    const db = getDatabase();
    const device = await authorizePlayer(db, request.headers.get("authorization"));
    const body = z
      .object({ revision: z.string().max(128).nullable() })
      .strict()
      .parse(await jsonBody(request));
    await acknowledgeFrame(db, device, body.revision);
    return Response.json({ ok: true }, { headers: privateHeaders });
  });
}
