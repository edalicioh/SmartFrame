import { createHash, timingSafeEqual } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import {
  controlDeckAgentExecuteSchema,
  controlDeckExecuteResultSchema,
  controlDeckHostStatusSchema,
  type ControlDeckAgentExecutePayload,
  type ControlDeckExecuteResult,
} from "@smartframe/contracts";
import type { HostDriver } from "./drivers/types";
import { MicPttLeaseManager } from "./lease-manager";
import {
  commandExists,
  listPublicShortcuts,
  type LocalShortcutsMap,
} from "./shortcuts";

const MAX_BODY_BYTES = 8192;
const DEDUP_TTL_MS = 60_000;
const DEDUP_MAX_ENTRIES = 500;
const NO_STORE = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

const digestBuffer = (value: string) =>
  createHash("sha256").update(value, "utf8").digest();

export function isLoopbackBindHost(host: string): boolean {
  return host === "127.0.0.1" || host === "::1";
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, NO_STORE);
  res.end(JSON.stringify(body));
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const lenHeader = Number(req.headers["content-length"]);
  if (Number.isFinite(lenHeader) && lenHeader > MAX_BODY_BYTES) {
    throw Object.assign(new Error("Corpo excede o limite."), { status: 413 });
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.byteLength;
    if (total > MAX_BODY_BYTES) {
      req.destroy();
      throw Object.assign(new Error("Corpo excede o limite."), { status: 413 });
    }
    chunks.push(buf);
  }
  const raw = Buffer.concat(chunks, total).toString("utf8");
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw Object.assign(new Error("JSON inválido."), { status: 400 });
  }
}

export type ControlDeckServerOptions = {
  host?: string;
  port?: number;
  token: string;
  driver: HostDriver;
  shortcuts?: LocalShortcutsMap;
  existsCheck?: (command: string) => Promise<boolean>;
  now?: () => number;
};

export type ControlDeckAgentInstance = {
  server: Server;
  leaseManager: MicPttLeaseManager;
  listen(): Promise<{ host: string; port: number }>;
  close(): Promise<void>;
};

export function createControlDeckAgentServer(
  options: ControlDeckServerOptions,
): ControlDeckAgentInstance {
  const host = options.host ?? "127.0.0.1";
  if (!isLoopbackBindHost(host)) {
    throw new Error(
      `Bind proibido para Control Deck Agent: "${host}". Somente loopback (127.0.0.1 ou ::1) é permitido.`,
    );
  }
  if (!options.token || options.token.length < 32 || /\s/.test(options.token)) {
    throw new Error(
      "Token do Control Deck Agent ausente, curto (mínimo de 32 caracteres) ou com espaços.",
    );
  }

  const expectedTokenDigest = digestBuffer(options.token);
  const shortcuts = options.shortcuts ?? {};
  const existsCheck = options.existsCheck ?? commandExists;
  const now = options.now ?? (() => Date.now());
  const leaseManager = new MicPttLeaseManager(
    (muted) => options.driver.controlMic({ mode: "set_mute", muted }),
    now,
  );
  const executionCache = new Map<
    string,
    { expiresAt: number; fingerprint: string; httpStatus: 200 | 504; result: ControlDeckExecuteResult }
  >();
  const inFlightExecutions = new Map<
    string,
    { fingerprint: string; promise: Promise<{ httpStatus: 200 | 504; result: ControlDeckExecuteResult }> }
  >();

  function buildCommandFingerprint(cmd: ControlDeckAgentExecutePayload): string {
    return JSON.stringify([
      cmd.deviceId,
      cmd.bindingId,
      cmd.kind,
      cmd.action,
      cmd.command,
      cmd.idempotent,
      cmd.value ?? null,
      cmd.muted ?? null,
      cmd.leaseSeconds ?? null,
      cmd.leaseId ?? null,
      cmd.leaseRequestId ?? null,
      cmd.target,
    ]);
  }

  function getCachedExecution(cacheKey: string) {
    const entry = executionCache.get(cacheKey);
    if (!entry) return null;
    if (entry.expiresAt <= now()) {
      executionCache.delete(cacheKey);
      return null;
    }
    return entry;
  }

  function rememberExecution(
    cacheKey: string,
    fingerprint: string,
    httpStatus: 200 | 504,
    result: ControlDeckExecuteResult,
  ) {
    const currentMs = now();
    if (executionCache.size >= DEDUP_MAX_ENTRIES) {
      for (const [key, item] of executionCache) {
        if (item.expiresAt <= currentMs || executionCache.size >= DEDUP_MAX_ENTRIES) {
          executionCache.delete(key);
        }
        if (executionCache.size < DEDUP_MAX_ENTRIES) break;
      }
    }
    executionCache.set(cacheKey, {
      expiresAt: currentMs + DEDUP_TTL_MS,
      fingerprint,
      httpStatus,
      result,
    });
  }

  function authorized(req: IncomingMessage): boolean {
    const auth = req.headers.authorization ?? "";
    const match = /^Bearer\s+(\S+)$/i.exec(auth);
    if (!match) return false;
    return timingSafeEqual(digestBuffer(match[1]), expectedTokenDigest);
  }

  const server = createServer(async (req, res) => {
    try {
      if (!authorized(req)) {
        sendJson(res, 401, { error: "Não autorizado." });
        return;
      }
      const path = (req.url ?? "/").split("?")[0];

      if (req.method === "GET" && path === "/health") {
        sendJson(res, 200, {
          ok: true,
          platform: options.driver.platform,
        });
        return;
      }

      if (req.method === "GET" && path === "/status") {
        const [rawStatus, publicShortcuts] = await Promise.all([
          options.driver.getStatus(),
          listPublicShortcuts(shortcuts, existsCheck),
        ]);
        const micSnap = leaseManager.snapshot();
        const status = controlDeckHostStatusSchema.parse({
          ...rawStatus,
          checkedAt: new Date(now()).toISOString(),
          mic: {
            available: rawStatus.mic.available,
            muted: rawStatus.mic.muted,
            pttActive: micSnap.pttActive,
            leaseId: micSnap.leaseId,
            leaseExpiresAt: micSnap.leaseExpiresAt,
          },
          shortcuts: publicShortcuts,
        });
        sendJson(res, 200, status);
        return;
      }

      if (req.method === "POST" && path === "/execute") {
        const body = await readJsonBody(req);
        const parsed = controlDeckAgentExecuteSchema.safeParse(body);
        if (!parsed.success) {
          sendJson(res, 400, { error: "Payload de execução inválido." });
          return;
        }
        const cmd = parsed.data;
        const cacheKey = `${cmd.deviceId}:${cmd.executionId}`;
        const fingerprint = buildCommandFingerprint(cmd);
        const cached = getCachedExecution(cacheKey);
        if (cached) {
          if (cached.fingerprint !== fingerprint) {
            sendJson(res, 409, { error: "executionId já utilizado por outro comando." });
            return;
          }
          sendJson(res, cached.httpStatus, cached.result);
          return;
        }
        const existingInFlight = inFlightExecutions.get(cacheKey);
        if (existingInFlight) {
          if (existingInFlight.fingerprint !== fingerprint) {
            sendJson(res, 409, { error: "executionId já utilizado por outro comando." });
            return;
          }
          const inFlightResult = await existingInFlight.promise;
          sendJson(res, inFlightResult.httpStatus, inFlightResult.result);
          return;
        }

        const runExecution = async (): Promise<{
          httpStatus: 200 | 504;
          result: ControlDeckExecuteResult;
        }> => {
          let httpStatus: 200 | 504 = 200;
          let result: ControlDeckExecuteResult;
          const mapUncertain = (uncertain?: boolean): boolean => {
            if (uncertain && !cmd.idempotent) {
              httpStatus = 504;
              result = {
                status: "unknown",
                bindingId: cmd.bindingId,
                executionId: cmd.executionId,
                idempotent: false,
                message: "Ação enviada ao host sem confirmação de retorno.",
              };
              return true;
            }
            return false;
          };

          if (cmd.kind === "shortcut") {
            const shortcutId =
              typeof cmd.target.shortcutId === "string" ? cmd.target.shortcutId : "";
            const def = shortcuts[shortcutId];
            if (!def) {
              result = {
                status: "rejected",
                bindingId: cmd.bindingId,
                executionId: cmd.executionId,
                idempotent: cmd.idempotent,
                message: "Atalho não cadastrado no host local.",
              };
            } else {
              const launched = await options.driver.launchShortcut(def);
              result = {
                status: launched.available ? "ok" : "unavailable",
                bindingId: cmd.bindingId,
                executionId: cmd.executionId,
                idempotent: cmd.idempotent,
                message: launched.message,
              };
            }
          } else if (cmd.kind === "media") {
            const mediaAction = cmd.action as
              | "play_pause"
              | "next"
              | "previous"
              | "stop";
            const out = await options.driver.triggerMedia(mediaAction);
            if (!mapUncertain(out.uncertain)) {
              result = {
                status: out.uncertain ? "error" : out.available ? "ok" : "unavailable",
                bindingId: cmd.bindingId,
                executionId: cmd.executionId,
                idempotent: cmd.idempotent,
                message: out.message,
                state: { playbackState: out.playbackState },
              };
            }
          } else if (cmd.kind === "volume") {
            const step =
              typeof cmd.target.step === "number" && Number.isFinite(cmd.target.step)
                ? Math.max(1, Math.min(25, Math.trunc(cmd.target.step)))
                : 5;
            const mode =
              cmd.action === "set_level"
                ? "set_level"
                : cmd.action === "set_mute"
                  ? "set_mute"
                  : cmd.action === "step_up"
                    ? "step_up"
                    : cmd.action === "step_down"
                      ? "step_down"
                      : "mute_toggle";
            const out = await options.driver.controlVolume({
              mode,
              step,
              level: cmd.value,
              muted: cmd.muted,
            });
            if (!mapUncertain(out.uncertain)) {
              result = {
                status: out.uncertain ? "error" : out.available ? "ok" : "unavailable",
                bindingId: cmd.bindingId,
                executionId: cmd.executionId,
                idempotent: cmd.idempotent,
                message: out.message,
                state: { level: out.level, muted: out.muted },
              };
            }
          } else if (cmd.kind === "app_volume") {
            const appName =
              typeof cmd.target.appName === "string" ? cmd.target.appName : "";
            const out = await options.driver.controlAppVolume({
              appName,
              mode: cmd.action === "set_level" ? "set_level" : "mute_toggle",
              level: cmd.value,
            });
            if (!mapUncertain(out.uncertain)) {
              result = {
                status: out.uncertain ? "error" : out.available ? "ok" : "unavailable",
                bindingId: cmd.bindingId,
                executionId: cmd.executionId,
                idempotent: cmd.idempotent,
                message: out.available ? out.message : "Sessão de áudio indisponível.",
                state: { level: out.level, muted: out.muted },
              };
            }
          } else if (cmd.kind === "brightness") {
            const step =
              typeof cmd.target.step === "number" && Number.isFinite(cmd.target.step)
                ? Math.max(1, Math.min(25, Math.trunc(cmd.target.step)))
                : 10;
            const mode =
              cmd.action === "set_level"
                ? "set_level"
                : cmd.action === "step_up"
                  ? "step_up"
                  : "step_down";
            const out = await options.driver.controlBrightness({
              mode,
              step,
              level: cmd.value,
            });
            if (!mapUncertain(out.uncertain)) {
              result = {
                status: out.uncertain ? "error" : out.available ? "ok" : "unavailable",
                bindingId: cmd.bindingId,
                executionId: cmd.executionId,
                idempotent: cmd.idempotent,
                message: out.message,
                state: { level: out.level },
              };
            }
          } else {
            const configuredLease =
              typeof cmd.target.leaseSeconds === "number" && Number.isFinite(cmd.target.leaseSeconds)
                ? Math.max(2, Math.min(30, Math.trunc(cmd.target.leaseSeconds)))
                : 10;
            if (cmd.action === "hold_unmute") {
              if (cmd.command === "ptt_acquire") {
                const acq = await leaseManager.acquire(
                  cmd.bindingId,
                  cmd.leaseSeconds ?? configuredLease,
                  cmd.leaseRequestId ?? cmd.executionId,
                  cmd.deviceId,
                );
                result = {
                  status: !acq.available ? "unavailable" : acq.ok ? "ok" : "error",
                  bindingId: cmd.bindingId,
                  executionId: cmd.executionId,
                  idempotent: true,
                  message: acq.message,
                  state: { muted: acq.muted },
                  ...(acq.lease ? { lease: acq.lease } : {}),
                };
              } else if (cmd.command === "ptt_renew") {
                const ren = await leaseManager.renew(
                  cmd.leaseId ?? "",
                  cmd.leaseSeconds ?? configuredLease,
                  cmd.bindingId,
                  cmd.deviceId,
                );
                result = {
                  status: ren.ok ? "ok" : "rejected",
                  bindingId: cmd.bindingId,
                  executionId: cmd.executionId,
                  idempotent: true,
                  message: ren.message,
                  state: { muted: ren.muted },
                  ...(ren.lease ? { lease: ren.lease } : {}),
                };
              } else {
                const rel = await leaseManager.release(
                  cmd.bindingId,
                  cmd.leaseId,
                  cmd.leaseRequestId,
                  cmd.deviceId,
                );
                result = {
                  status: !rel.available
                    ? "unavailable"
                    : rel.ok
                      ? "ok"
                      : "rejected",
                  bindingId: cmd.bindingId,
                  executionId: cmd.executionId,
                  idempotent: true,
                  message: rel.message,
                  state: { muted: rel.muted },
                };
              }
            } else {
              const guarded = await leaseManager.runManualMic(() =>
                options.driver.controlMic({
                  mode: cmd.action === "set_mute" ? "set_mute" : "toggle_mute",
                  muted: cmd.muted,
                  pinEndpoint: false,
                }),
              );
              if (guarded.blocked) {
                result = {
                  status: "rejected",
                  bindingId: cmd.bindingId,
                  executionId: cmd.executionId,
                  idempotent: cmd.idempotent,
                  message: "Operação bloqueada durante Push-to-Talk ativo.",
                };
              } else if (!mapUncertain(guarded.result.uncertain)) {
                result = {
                  status: guarded.result.uncertain
                    ? "error"
                    : guarded.result.available
                      ? "ok"
                      : "unavailable",
                  bindingId: cmd.bindingId,
                  executionId: cmd.executionId,
                  idempotent: cmd.idempotent,
                  message: guarded.result.message,
                  state: { muted: guarded.result.muted },
                };
              }
            }
          }

          const validated = controlDeckExecuteResultSchema.parse({
            ...result!,
            message: result!.message.slice(0, 240),
          });
          rememberExecution(cacheKey, fingerprint, httpStatus, validated);
          return { httpStatus, result: validated };
        };

        const executionPromise = runExecution();
        inFlightExecutions.set(cacheKey, {
          fingerprint,
          promise: executionPromise,
        });
        try {
          const outcome = await executionPromise;
          sendJson(res, outcome.httpStatus, outcome.result);
        } finally {
          inFlightExecutions.delete(cacheKey);
        }
        return;
      }

      sendJson(res, 404, { error: "Rota não encontrada." });
    } catch (error) {
      const status =
        typeof (error as { status?: number })?.status === "number"
          ? (error as { status: number }).status
          : 500;
      sendJson(res, status, {
        error: status < 500 ? (error as Error).message : "Erro interno.",
      });
    }
  });

  return {
    server,
    leaseManager,
    listen() {
      return new Promise((resolvePromise, reject) => {
        server.once("error", reject);
        server.listen(options.port ?? 0, host, () => {
          server.removeListener("error", reject);
          const addr = server.address();
          if (!addr || typeof addr === "string") {
            reject(new Error("Endereço do servidor indisponível."));
            return;
          }
          resolvePromise({ host: addr.address, port: addr.port });
        });
      });
    },
    async close() {
      await leaseManager.shutdown();
      await new Promise<void>((resolvePromise, reject) => {
        server.close((err) => (err ? reject(err) : resolvePromise()));
      });
    },
  };
}
