import { createHash } from "node:crypto";
import {
  controlDeckAgentExecuteSchema,
  controlDeckBindingCreateSchema,
  controlDeckBindingTargetSchema,
  controlDeckBindingUpdateSchema,
  controlDeckExecuteRequestSchema,
  controlDeckExecuteResultSchema,
  controlDeckHostStatusSchema,
  controlDeckPlayerWidgetDataSchema,
  isControlDeckActionIdempotent,
  unavailableControlDeckHostStatus,
  type ControlDeckAgentExecutePayload,
  type ControlDeckBindingSpec,
  type ControlDeckExecuteRequest,
  type ControlDeckExecuteResult,
  type ControlDeckHostStatus,
  type ControlDeckKind,
  type ControlDeckPlayerBinding,
  type ControlDeckPlayerWidgetData,
  type OnlineDashboard,
} from "@smartframe/contracts";
import type { PrismaClient } from "@smartframe/database";
import { FrameError } from "./index";

const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const MIN_AGENT_TOKEN_LENGTH = 32;
const AGENT_STATUS_TIMEOUT_MS = 2500;
const AGENT_EXECUTE_TIMEOUT_MS = 5000;
const MAX_CONTROL_DECK_BINDINGS = 50;
const RATE_WINDOW_MS = 60_000;
const MAX_DEVICE_COMMANDS_PER_MINUTE = 60;
const MAX_PTT_RENEWS_PER_MINUTE = 120;
const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function createControlDeckBindingRevision(binding: {
  id: string;
  kind: string;
  action: string;
  target: unknown;
}): string {
  const snapshot = stableJson({
    id: binding.id,
    kind: binding.kind,
    action: binding.action,
    target: binding.target,
  });
  return createHash("sha256").update(snapshot).digest("hex");
}

const PRE_SEND_UNAVAILABLE_CODES = new Set(["ECONNREFUSED", "ENOTFOUND", "EHOSTUNREACH"]);
const POST_SEND_OR_TIMEOUT_CODES = new Set([
  "ECONNRESET",
  "EPIPE",
  "UND_ERR_SOCKET",
  "UND_ERR_ABORTED",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "ABORT_ERR",
]);

type StoredBindingTarget = Parameters<PrismaClient["controlDeckBinding"]["create"]>[0]["data"]["target"];

export type ControlDeckAgentConfig = {
  url: string;
  token: string;
};

export function isControlDeckHostAuthorizedForHousehold(householdId: string): boolean {
  const configured = process.env.SMARTFRAME_CONTROL_DECK_HOUSEHOLD_ID?.trim();
  return Boolean(configured && configured === householdId);
}

export type ControlDeckAgentStatusResponse = {
  configured: boolean;
  reachable: boolean;
  status: ControlDeckHostStatus;
};

export type ControlDeckDispatchResponse = {
  httpStatus: 200 | 503 | 504;
  result: ControlDeckExecuteResult;
};

export type ControlDeckBindingRecord = {
  id: string;
  label: string;
  kind: ControlDeckKind;
  action: string;
  target: Record<string, unknown>;
  idempotent: boolean;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

function parseControlDeckAgentConfig(
  rawUrl: string | undefined | null,
  rawToken: string | undefined | null,
): ControlDeckAgentConfig | null {
  const trimmedUrl = rawUrl?.trim();
  const token = rawToken?.trim();
  if (!trimmedUrl || !token || token.length < MIN_AGENT_TOKEN_LENGTH || /\s/.test(token)) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmedUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:") return null;
  if (parsed.username || parsed.password || parsed.search || parsed.hash) return null;
  if (parsed.pathname !== "/" && parsed.pathname !== "") return null;
  if (!LOOPBACK_HOSTNAMES.has(parsed.hostname.toLowerCase())) return null;
  return { url: parsed.origin, token };
}

/** Read and strictly validate the loopback-only Control Deck host agent configuration. */
export function getControlDeckAgentConfig(): ControlDeckAgentConfig | null {
  return parseControlDeckAgentConfig(
    process.env.SMARTFRAME_CONTROL_DECK_URL,
    process.env.SMARTFRAME_CONTROL_DECK_TOKEN,
  );
}

/** Fetch real host agent capabilities and state without inventing fallback numeric values. */
export async function fetchControlDeckAgentStatus(
  configOverride?: ControlDeckAgentConfig | null,
): Promise<ControlDeckAgentStatusResponse> {
  const cfg =
    configOverride === undefined
      ? getControlDeckAgentConfig()
      : configOverride
        ? parseControlDeckAgentConfig(configOverride.url, configOverride.token)
        : null;

  if (!cfg) {
    return {
      configured: false,
      reachable: false,
      status: unavailableControlDeckHostStatus(),
    };
  }

  try {
    const response = await fetch(`${cfg.url}/status`, {
      method: "GET",
      headers: {
        authorization: `Bearer ${cfg.token}`,
        accept: "application/json",
      },
      redirect: "error",
      signal: AbortSignal.timeout(AGENT_STATUS_TIMEOUT_MS),
    });
    if (!response.ok) {
      return {
        configured: true,
        reachable: false,
        status: unavailableControlDeckHostStatus(),
      };
    }
    const json = (await response.json()) as unknown;
    const status = controlDeckHostStatusSchema.parse(json);
    return {
      configured: true,
      reachable: true,
      status,
    };
  } catch {
    return {
      configured: true,
      reachable: false,
      status: unavailableControlDeckHostStatus(),
    };
  }
}

function isPreSendUnavailableError(error: unknown): boolean {
  const queue: unknown[] = [error];
  const seen = new Set<unknown>();
  let sawPreSendCode = false;
  let steps = 0;

  while (queue.length > 0 && steps < 32) {
    steps += 1;
    const current = queue.shift();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);

    const record = current as {
      name?: unknown;
      code?: unknown;
      cause?: unknown;
      errors?: unknown;
    };

    if (record.name === "AbortError" || record.name === "TimeoutError") {
      return false;
    }
    if (typeof record.code === "string") {
      if (POST_SEND_OR_TIMEOUT_CODES.has(record.code)) {
        return false;
      }
      if (PRE_SEND_UNAVAILABLE_CODES.has(record.code)) {
        sawPreSendCode = true;
      }
    }
    if (record.cause !== undefined) {
      queue.push(record.cause);
    }
    if (Array.isArray(record.errors)) {
      for (const nested of record.errors) {
        queue.push(nested);
      }
    }
  }

  return sawPreSendCode;
}

function buildPostSendFailureResponse(
  payload: ControlDeckAgentExecutePayload,
): ControlDeckDispatchResponse {
  if (!payload.idempotent) {
    return {
      httpStatus: 504,
      result: controlDeckExecuteResultSchema.parse({
        status: "unknown",
        bindingId: payload.bindingId,
        executionId: payload.executionId,
        idempotent: false,
        message:
          "Conexão perdida após o envio; o resultado da ação é desconhecido e não foi reenviado automaticamente.",
      }),
    };
  }
  return {
    httpStatus: 503,
    result: controlDeckExecuteResultSchema.parse({
      status: "error",
      bindingId: payload.bindingId,
      executionId: payload.executionId,
      idempotent: true,
      message: "Falha ao confirmar a execução no host.",
    }),
  };
}

function fixedExecutionMessage(
  status: ControlDeckExecuteResult["status"],
  payload: Pick<ControlDeckAgentExecutePayload, "command">,
): string {
  switch (status) {
    case "ok":
      if (payload.command === "ptt_acquire") return "Push-to-Talk ativo com expiração automática.";
      if (payload.command === "ptt_renew") return "Lease Push-to-Talk renovado.";
      if (payload.command === "ptt_release") return "Microfone silenciado.";
      return "Comando executado no host.";
    case "unavailable":
      return "Host ou recurso indisponível no momento.";
    case "rejected":
      return "Comando recusado pelo host.";
    case "unknown":
      return "Conexão perdida após o envio; o resultado da ação é desconhecido e não foi reenviado automaticamente.";
    case "error":
      return "Falha ao confirmar a execução no host.";
  }
}

/** Dispatch one execution request to the loopback agent with zero automatic retries. */
export async function dispatchControlDeckAgentCommand(
  cfg: ControlDeckAgentConfig | null,
  payload: ControlDeckAgentExecutePayload,
): Promise<ControlDeckDispatchResponse> {
  const validPayload = controlDeckAgentExecuteSchema.parse(payload);
  const validCfg = cfg ? parseControlDeckAgentConfig(cfg.url, cfg.token) : null;

  if (!validCfg) {
    return {
      httpStatus: 200,
      result: controlDeckExecuteResultSchema.parse({
        status: "unavailable",
        bindingId: validPayload.bindingId,
        executionId: validPayload.executionId,
        idempotent: validPayload.idempotent,
        message: "Agente local do Control Deck indisponível.",
      }),
    };
  }

  try {
    const response = await fetch(`${validCfg.url}/execute`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${validCfg.token}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(validPayload),
      redirect: "error",
      signal: AbortSignal.timeout(AGENT_EXECUTE_TIMEOUT_MS),
    });

    if (!response.ok) {
      return buildPostSendFailureResponse(validPayload);
    }

    const json = (await response.json()) as unknown;
    const parsed = controlDeckExecuteResultSchema.safeParse(json);
    if (
      !parsed.success ||
      parsed.data.bindingId !== validPayload.bindingId ||
      parsed.data.executionId !== validPayload.executionId
    ) {
      return buildPostSendFailureResponse(validPayload);
    }

    return {
      httpStatus: 200,
      result: {
        ...parsed.data,
        message: fixedExecutionMessage(parsed.data.status, validPayload),
      },
    };
  } catch (error) {
    if (isPreSendUnavailableError(error)) {
      return {
        httpStatus: 200,
        result: controlDeckExecuteResultSchema.parse({
          status: "unavailable",
          bindingId: validPayload.bindingId,
          executionId: validPayload.executionId,
          idempotent: validPayload.idempotent,
          message: "Agente local do Control Deck indisponível.",
        }),
      };
    }
    return buildPostSendFailureResponse(validPayload);
  }
}

function serializeBinding(row: {
  id: string;
  label: string;
  kind: string;
  action: string;
  target: unknown;
  idempotent: boolean;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}): ControlDeckBindingRecord {
  return {
    id: row.id,
    label: row.label,
    kind: row.kind as ControlDeckKind,
    action: row.action,
    target:
      row.target && typeof row.target === "object" && !Array.isArray(row.target)
        ? (row.target as Record<string, unknown>)
        : {},
    idempotent: row.idempotent,
    enabled: row.enabled,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listControlDeckBindings(
  db: PrismaClient,
  householdId: string,
): Promise<ControlDeckBindingRecord[]> {
  const rows = await db.controlDeckBinding.findMany({
    where: { householdId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: MAX_CONTROL_DECK_BINDINGS,
  });
  return rows.map(serializeBinding);
}

export async function createControlDeckBinding(
  db: PrismaClient,
  householdId: string,
  actorId: string,
  input: unknown,
): Promise<ControlDeckBindingRecord> {
  const parsed = controlDeckBindingCreateSchema.parse(input);
  const idempotent = isControlDeckActionIdempotent(parsed.kind, parsed.action);

  const created = await db.$transaction(async (tx) => {
    const count = await tx.controlDeckBinding.count({ where: { householdId } });
    if (count >= MAX_CONTROL_DECK_BINDINGS) {
      throw new FrameError(
        409,
        `Limite de ${MAX_CONTROL_DECK_BINDINGS} vínculos do Control Deck por residência atingido.`,
      );
    }
    const row = await tx.controlDeckBinding.create({
      data: {
        householdId,
        label: parsed.label,
        kind: parsed.kind,
        action: parsed.action,
        target: parsed.target as StoredBindingTarget,
        idempotent,
        enabled: parsed.enabled,
      },
    });
    await tx.auditLog.create({
      data: { householdId, actorId, action: "control_deck.binding.created" },
    });
    return row;
  });

  return serializeBinding(created);
}

export async function updateControlDeckBinding(
  db: PrismaClient,
  householdId: string,
  actorId: string,
  input: unknown,
): Promise<ControlDeckBindingRecord> {
  const parsed = controlDeckBindingUpdateSchema.parse(input);
  const idempotent = isControlDeckActionIdempotent(parsed.kind, parsed.action);

  const updatedRow = await db.$transaction(async (tx) => {
    const updated = await tx.controlDeckBinding.updateMany({
      where: { id: parsed.id, householdId },
      data: {
        label: parsed.label,
        kind: parsed.kind,
        action: parsed.action,
        target: parsed.target as StoredBindingTarget,
        idempotent,
        enabled: parsed.enabled,
      },
    });
    if (updated.count !== 1) {
      throw new FrameError(404, "Vínculo do Control Deck não encontrado.");
    }
    const row = await tx.controlDeckBinding.findFirst({
      where: { id: parsed.id, householdId },
    });
    if (!row) {
      throw new FrameError(404, "Vínculo do Control Deck não encontrado.");
    }
    await tx.auditLog.create({
      data: { householdId, actorId, action: "control_deck.binding.updated" },
    });
    return row;
  });

  return serializeBinding(updatedRow);
}

export async function deleteControlDeckBinding(
  db: PrismaClient,
  householdId: string,
  actorId: string,
  id: string,
): Promise<void> {
  if (!id || typeof id !== "string" || !SAFE_ID_PATTERN.test(id)) {
    throw new FrameError(400, "Identificador do vínculo do Control Deck inválido.");
  }

  await db.$transaction(async (tx) => {
    const deleted = await tx.controlDeckBinding.deleteMany({
      where: { id, householdId },
    });
    if (deleted.count !== 1) {
      throw new FrameError(404, "Vínculo do Control Deck não encontrado.");
    }
    await tx.auditLog.create({
      data: { householdId, actorId, action: "control_deck.binding.deleted" },
    });
  });
}

function projectBindingForPlayer(
  row: { id: string; label: string; kind: string; action: string; target: unknown },
  hostStatus: ControlDeckHostStatus,
  shortcutAvailability: ReadonlyMap<string, boolean>,
): ControlDeckPlayerBinding | null {
  const parsedSpec = controlDeckBindingTargetSchema.safeParse({
    kind: row.kind,
    action: row.action,
    target: row.target,
  });
  if (!parsedSpec.success) return null;

  const spec = parsedSpec.data;
  const hostAvailable = hostStatus.available;
  const idempotent = isControlDeckActionIdempotent(spec.kind, spec.action);

  let available = false;
  let level: number | null = null;
  let muted: boolean | null = null;
  let leaseSeconds: number | null = null;

  switch (spec.kind) {
    case "shortcut":
      available =
        hostStatus.capabilities.shortcuts &&
        Boolean(shortcutAvailability.get(spec.target.shortcutId));
      break;
    case "media":
      available = hostAvailable && hostStatus.capabilities.media;
      break;
    case "volume":
      available = hostAvailable && hostStatus.capabilities.volume;
      if (available) {
        level = hostStatus.volume.level;
        muted = hostStatus.volume.muted;
      }
      break;
    case "app_volume":
      available = hostAvailable && hostStatus.capabilities.appVolume;
      break;
    case "brightness":
      available = hostAvailable && hostStatus.capabilities.brightness;
      if (available) {
        level = hostStatus.brightness.level;
      }
      break;
    case "mic_ptt":
      available = hostAvailable && hostStatus.capabilities.mic;
      leaseSeconds = spec.target.leaseSeconds;
      if (available) {
        muted = hostStatus.mic.muted;
      }
      break;
  }

  return {
    bindingId: row.id,
    label: row.label,
    kind: spec.kind,
    action: spec.action,
    idempotent,
    available,
    level,
    muted,
    leaseSeconds,
  };
}

/**
 * Project sanitized Control Deck status and bindings for the player/preview.
 * Never exposes `target`, `shortcutId`, `appName`, physical paths, args, scripts or tokens.
 */
export async function buildPlayerControlDeckData(
  db: PrismaClient,
  householdId: string,
  config: OnlineDashboard,
): Promise<ControlDeckPlayerWidgetData> {
  const hostAuthorized = isControlDeckHostAuthorizedForHousehold(householdId);
  const bindingIds = [...new Set(config.widgets.controlDeck.tiles.map((tile) => tile.bindingId))];

  const [rows, agentStatus] = await Promise.all([
    bindingIds.length > 0
      ? db.controlDeckBinding.findMany({
          where: { id: { in: bindingIds }, householdId, enabled: true },
          select: { id: true, label: true, kind: true, action: true, target: true },
        })
      : Promise.resolve([]),
    hostAuthorized
      ? fetchControlDeckAgentStatus()
      : Promise.resolve({
          configured: false,
          reachable: false,
          status: unavailableControlDeckHostStatus(),
        }),
  ]);

  const hostStatus = agentStatus.status;
  const shortcutAvailability = new Map(
    hostStatus.shortcuts.map((shortcut) => [shortcut.shortcutId, shortcut.available]),
  );

  const bindings: Record<string, ControlDeckPlayerBinding> = {};
  for (const row of rows) {
    const projected = projectBindingForPlayer(row, hostStatus, shortcutAvailability);
    if (projected) {
      bindings[row.id] = projected;
    }
  }

  return controlDeckPlayerWidgetDataSchema.parse({
    available: agentStatus.reachable && hostStatus.available,
    checkedAt: agentStatus.reachable ? hostStatus.checkedAt : null,
    hostStatus: {
      volume: hostStatus.volume,
      brightness: hostStatus.brightness,
      mic: {
        available: hostStatus.mic.available,
        muted: hostStatus.mic.muted,
        pttActive: hostStatus.mic.pttActive,
        leaseExpiresAt: hostStatus.mic.leaseExpiresAt,
      },
      media: hostStatus.media,
    },
    bindings,
  });
}

async function limitDeviceControlDeck(
  db: PrismaClient,
  deviceId: string,
  command: ControlDeckExecuteRequest["command"],
): Promise<void> {
  // Silenciar microfone ao soltar Push-to-Talk nunca deve ser bloqueado por cota.
  if (command === "ptt_release") return;

  const isPttRenew = command === "ptt_renew";
  const maxPerMinute = isPttRenew ? MAX_PTT_RENEWS_PER_MINUTE : MAX_DEVICE_COMMANDS_PER_MINUTE;
  const limitKey = isPttRenew ? `cd:ptt:${deviceId}` : `cd:dev:${deviceId}`;
  const now = new Date();
  await db.$transaction(async (tx) => {
    const record = await tx.requestLimit.upsert({
      where: { key: limitKey },
      create: { key: limitKey, windowStart: now, count: 1 },
      update: { count: { increment: 1 } },
    });
    if (now.getTime() - record.windowStart.getTime() >= RATE_WINDOW_MS) {
      await tx.requestLimit.update({
        where: { key: limitKey },
        data: { count: 1, windowStart: now },
      });
    } else if (record.count > maxPerMinute) {
      throw new FrameError(
        429,
        "Limite de comandos do Control Deck por minuto excedido. Aguarde antes de tentar novamente.",
      );
    }
  });
}

function assertCommandCompatible(
  spec: ControlDeckBindingSpec,
  req: ControlDeckExecuteRequest,
): void {
  const hasValue = req.value !== undefined;
  const hasMuted = req.muted !== undefined;
  const hasLeaseSeconds = req.leaseSeconds !== undefined;
  const hasLeaseId = req.leaseId !== undefined;
  const hasLeaseRequestId = req.leaseRequestId !== undefined;

  if (spec.kind === "mic_ptt" && spec.action === "hold_unmute") {
    if (
      req.command !== "ptt_acquire" &&
      req.command !== "ptt_renew" &&
      req.command !== "ptt_release"
    ) {
      throw new FrameError(400, "Comando incompatível com Push-to-Talk.");
    }
    if (hasValue || hasMuted) {
      throw new FrameError(400, "Parâmetros numéricos ou de mudo não se aplicam ao Push-to-Talk.");
    }
    if (req.command === "ptt_acquire" && hasLeaseId) {
      throw new FrameError(400, "leaseId não deve ser informado ao iniciar Push-to-Talk.");
    }
    if (req.command === "ptt_acquire" && req.leaseRequestId !== req.executionId) {
      throw new FrameError(400, "leaseRequestId deve corresponder à aquisição.");
    }
    if (req.command === "ptt_renew" && !req.leaseId) {
      throw new FrameError(400, "leaseId é obrigatório para renovar Push-to-Talk.");
    }
    if (req.command === "ptt_release" && !hasLeaseId && !hasLeaseRequestId) {
      throw new FrameError(400, "leaseRequestId é obrigatório para release sem leaseId.");
    }
    return;
  }

  if (
    req.command === "ptt_acquire" ||
    req.command === "ptt_renew" ||
    req.command === "ptt_release" ||
    hasLeaseSeconds ||
    hasLeaseId ||
    hasLeaseRequestId
  ) {
    throw new FrameError(400, "Comando Push-to-Talk inválido para este vínculo.");
  }

  if (spec.action === "set_level") {
    if (req.command !== "set_level" || req.value === undefined || hasMuted) {
      throw new FrameError(400, "Comando set_level exige value entre 0 e 100.");
    }
    return;
  }

  if (spec.action === "set_mute") {
    if (req.command !== "set_mute" || req.muted === undefined || hasValue) {
      throw new FrameError(400, "Comando set_mute exige muted booleano.");
    }
    return;
  }

  if (req.command !== "trigger" || hasValue || hasMuted) {
    throw new FrameError(400, "Este vínculo aceita apenas o comando trigger sem parâmetros extras.");
  }
}

async function assertExecutionStillAuthorized(
  db: PrismaClient,
  device: {
    id: string;
    householdId: string;
    tokenHash?: string | null;
    activePanelId?: string | null;
    activePanelVersionId?: string | null;
  },
  bindingId: string,
  expectedBindingRevision: string,
  expectedRevision?: string,
): Promise<void> {
  const currentDevice = await db.device.findFirst({
    where: {
      id: device.id,
      householdId: device.householdId,
      revokedAt: null,
      ...(device.tokenHash ? { tokenHash: device.tokenHash } : {}),
    },
    select: {
      id: true,
      activePanelId: true,
      activePanelVersionId: true,
    },
  });
  if (!currentDevice) {
    throw new FrameError(401, "Dispositivo não autorizado.");
  }
  if (
    device.activePanelId !== undefined &&
    (currentDevice.activePanelId !== device.activePanelId ||
      currentDevice.activePanelVersionId !== device.activePanelVersionId)
  ) {
    throw new FrameError(409, "O painel exibido mudou. Atualize antes de executar o comando.");
  }
  if (expectedRevision) {
    let activeVersionId: string | null = null;
    if (currentDevice.activePanelId) {
      const version = await db.layoutVersion.findFirst({
        where: {
          id: currentDevice.activePanelVersionId ?? "",
          layoutId: currentDevice.activePanelId,
          layout: { householdId: device.householdId },
        },
        select: { id: true },
      });
      activeVersionId = version?.id ?? null;
    } else {
      const layout = await db.layout.findFirst({
        where: { key: `online:${currentDevice.id}`, householdId: device.householdId },
        include: { publishedVersion: { select: { id: true, layoutId: true } } },
      });
      if (layout && layout.publishedVersion && layout.publishedVersion.layoutId === layout.id) {
        activeVersionId = layout.publishedVersion.id;
      }
    }
    if (`online:${activeVersionId ?? ""}` !== expectedRevision) {
      throw new FrameError(409, "O painel exibido mudou. Atualize antes de executar o comando.");
    }
  }

  const currentBinding = await db.controlDeckBinding.findFirst({
    where: { id: bindingId, householdId: device.householdId, enabled: true },
  });
  if (!currentBinding) {
    throw new FrameError(404, "Vínculo do Control Deck não encontrado.");
  }
  if (createControlDeckBindingRevision(currentBinding) !== expectedBindingRevision) {
    throw new FrameError(
      409,
      "A ação do Control Deck mudou após a publicação. Publique novamente antes de executar.",
    );
  }
}

export async function executePlayerControlDeckCommand(
  db: PrismaClient,
  device: {
    id: string;
    householdId: string;
    tokenHash?: string | null;
    activePanelId?: string | null;
    activePanelVersionId?: string | null;
  },
  body: unknown,
  activeConfig: OnlineDashboard,
  publishedAt: Date,
  expectedRevision?: string,
): Promise<ControlDeckDispatchResponse> {
  if (!isControlDeckHostAuthorizedForHousehold(device.householdId)) {
    throw new FrameError(403, "Agente Control Deck não autorizado para esta residência.");
  }
  const parsed = controlDeckExecuteRequestSchema.parse(body);

  await limitDeviceControlDeck(db, device.id, parsed.command);

  const pageEnabledWidgets = new Set(activeConfig.pages?.flatMap((page) => page.enabledWidgets) ?? []);
  const controlDeckEnabled =
    activeConfig.widgets.controlDeck.enabled || pageEnabledWidgets.has("controlDeck");
  const publishedTile = activeConfig.widgets.controlDeck.tiles.find(
    (tile) => tile.bindingId === parsed.bindingId,
  );
  if (!controlDeckEnabled || !publishedTile) {
    throw new FrameError(403, "Controle não habilitado ou não publicado neste painel.");
  }

  const binding = await db.controlDeckBinding.findFirst({
    where: { id: parsed.bindingId, householdId: device.householdId, enabled: true },
  });
  if (!binding) {
    throw new FrameError(404, "Vínculo do Control Deck não encontrado.");
  }
  const currentBindingRevision = createControlDeckBindingRevision(binding);
  if (
    (publishedTile.bindingRevision &&
      publishedTile.bindingRevision !== currentBindingRevision) ||
    (!publishedTile.bindingRevision && binding.updatedAt > publishedAt)
  ) {
    throw new FrameError(
      409,
      "A ação do Control Deck mudou após a publicação. Publique novamente antes de executar.",
    );
  }

  const spec = controlDeckBindingTargetSchema.parse({
    kind: binding.kind,
    action: binding.action,
    target: binding.target,
  });

  assertCommandCompatible(spec, parsed);

  const isPttLeaseCommand =
    parsed.command === "ptt_acquire" ||
    parsed.command === "ptt_renew" ||
    parsed.command === "ptt_release";
  const idempotent = isPttLeaseCommand
    ? true
    : isControlDeckActionIdempotent(spec.kind, spec.action);

  const agentPayload = controlDeckAgentExecuteSchema.parse({
    deviceId: device.id,
    executionId: parsed.executionId,
    bindingId: binding.id,
    kind: spec.kind,
    action: spec.action,
    target: spec.target,
    idempotent,
    command: parsed.command,
    ...(parsed.value !== undefined ? { value: parsed.value } : {}),
    ...(parsed.muted !== undefined ? { muted: parsed.muted } : {}),
    ...(parsed.leaseSeconds !== undefined ? { leaseSeconds: parsed.leaseSeconds } : {}),
    ...(parsed.leaseId !== undefined ? { leaseId: parsed.leaseId } : {}),
    ...(parsed.leaseRequestId !== undefined
      ? { leaseRequestId: parsed.leaseRequestId }
      : {}),
  });

  await assertExecutionStillAuthorized(
    db,
    device,
    binding.id,
    currentBindingRevision,
    expectedRevision,
  );

  const dispatch = await dispatchControlDeckAgentCommand(getControlDeckAgentConfig(), agentPayload);
  await db.auditLog.create({
    data: { householdId: device.householdId, actorId: device.id, action: "control_deck.executed" },
  });
  return dispatch;
}
