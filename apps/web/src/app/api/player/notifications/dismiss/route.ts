import { z } from "zod";
import { getDatabase } from "@smartframe/database";
import { authorizePlayer, FrameError } from "@smartframe/frames";
import { frameResponse, jsonBody, privateHeaders } from "@/lib/frame-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const dismissBodySchema = z
  .object({
    notificationId: z.string().min(1).max(128),
  })
  .strict();

export async function POST(request: Request) {
  return frameResponse(async () => {
    const db = getDatabase();
    const device = await authorizePlayer(db, request.headers.get("authorization"));
    const params = new URL(request.url).searchParams;
    if (params.has("deviceId") && params.get("deviceId") !== device.id) {
      throw new FrameError(403, "Dispositivo não autorizado.");
    }
    const body = dismissBodySchema.parse(await jsonBody(request));
    await db.deviceNotification.updateMany({
      where: {
        id: body.notificationId,
        householdId: device.householdId,
        deviceId: device.id,
        dismissedAt: null,
      },
      data: { dismissedAt: new Date() },
    });
    return Response.json({ ok: true }, { headers: privateHeaders });
  });
}
