import { z } from "zod";
import { getDatabase } from "@smartframe/database";
import { limitPairing, redeemPairingCode } from "@smartframe/frames";
import { frameResponse, jsonBody, privateHeaders } from "@/lib/frame-api";

export const runtime = "nodejs";
export async function POST(request: Request) {
  return frameResponse(async () => {
    const db = getDatabase();
    await limitPairing(
      db,
      (request.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim().slice(0, 256),
    );
    const body = z
      .object({ code: z.string().max(30), name: z.string().trim().min(1).max(100) })
      .strict()
      .parse(await jsonBody(request));
    return Response.json(await redeemPairingCode(db, body.code, body.name), {
      headers: privateHeaders,
    });
  });
}
