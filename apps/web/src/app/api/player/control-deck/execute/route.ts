import { controlDeckExecuteRequestSchema, readStoredOnlineDashboard } from "@smartframe/contracts";
import { getDatabase } from "@smartframe/database";
import {
  authorizePlayer,
  executePlayerControlDeckCommand,
  FrameError,
} from "@smartframe/frames";
import { activeOnlineVersion } from "@/lib/active-online-version";
import { frameResponse, jsonBody, privateHeaders } from "@/lib/frame-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return frameResponse(async () => {
    const rawBody = await jsonBody(request);
    const body = controlDeckExecuteRequestSchema.parse(rawBody);
    const db = getDatabase();
    const device = await authorizePlayer(db, request.headers.get("authorization"));
    const params = new URL(request.url).searchParams;
    if (params.has("deviceId") && params.get("deviceId") !== device.id) {
      throw new FrameError(403, "Dispositivo não autorizado.");
    }
    const version = await activeOnlineVersion(db, device);
    if (!version) {
      throw new FrameError(409, "Este dispositivo ainda não possui uma configuração publicada.");
    }
    if (body.revision !== `online:${version.id}`) {
      throw new FrameError(409, "O painel exibido mudou. Atualize antes de executar o comando.");
    }
    const activeConfig = readStoredOnlineDashboard(version.config);
    const dispatch = await executePlayerControlDeckCommand(
      db,
      device,
      body,
      activeConfig,
      version.createdAt,
      `online:${version.id}`,
    );
    return Response.json(dispatch.result, { status: dispatch.httpStatus, headers: privateHeaders });
  });
}
