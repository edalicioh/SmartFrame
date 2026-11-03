import "server-only";
import { ZodError } from "zod";
import { FrameError } from "@smartframe/frames";
import { panelAccess } from "./panel-access";

export const privateHeaders = { "Cache-Control": "private, no-store" };

export async function administrator(request: Request, mutate = false) {
  if (mutate && request.headers.get("origin") !== new URL(process.env.BETTER_AUTH_URL!).origin)
    throw new FrameError(403, "Origem não autorizada.");
  const context = await panelAccess(request.headers);
  if (!context) throw new FrameError(401, "Autenticação necessária.");
  return { householdId: context.household.id, actorId: context.user.id };
}

export async function limitedBody(request: Request, limit: number) {
  if (Number(request.headers.get("content-length")) > limit)
    throw new FrameError(413, "Arquivo ou requisição muito grande.");
  const reader = request.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        throw new FrameError(413, "Arquivo ou requisição muito grande.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

export async function jsonBody(request: Request) {
  try {
    return JSON.parse((await limitedBody(request, 16_384)).toString("utf8")) as unknown;
  } catch (error) {
    if (error instanceof FrameError) throw error;
    throw new FrameError(400, "JSON inválido.");
  }
}

export async function frameResponse(action: () => Promise<Response>) {
  try {
    return await action();
  } catch (error) {
    if (error instanceof FrameError)
      return Response.json(
        { error: error.message },
        { status: error.status, headers: privateHeaders },
      );
    if (error instanceof ZodError)
      return Response.json(
        { error: "Configuração inválida. Confira os campos informados." },
        { status: 400, headers: privateHeaders },
      );
    console.error("SmartFrame: falha interna na operação de layout ou dispositivo.");
    return Response.json(
      { error: "Não foi possível concluir a operação." },
      { status: 500, headers: privateHeaders },
    );
  }
}
