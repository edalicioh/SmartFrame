export type DeviceSummary = {
  id: string;
  name: string;
  lastSeenAt: string | null;
  appliedRevision: string | null;
  activePanelId: string | null;
  activePanelVersionId: string | null;
};

export type PanelSummary = {
  id: string;
  name: string;
};

export type PanelAccessItem = {
  panelId: string;
  versionId: string;
};

export type PairingInfo = {
  code: string;
  expiresAt: string;
  serverURL: string;
};

export type PublishMode = "available" | "activate";

export type PublishTarget = {
  panelId: string;
  panelName: string;
  draftRevision: number;
  deviceId: string | null;
  deviceName: string | null;
};

export function hasDuplicateDeviceNames(devices: readonly Pick<DeviceSummary, "name">[]): boolean {
  const seen = new Set<string>();
  for (const device of devices) {
    if (seen.has(device.name)) return true;
    seen.add(device.name);
  }
  return false;
}

export function formatUniqueDisplayName<T extends { id: string; name: string }>(
  entity: T,
  allEntities: readonly T[],
): string {
  const list = allEntities.some((item) => item.id === entity.id)
    ? allEntities.map((item) => (item.id === entity.id ? entity : item))
    : [...allEntities, entity];
  const nameCounts = new Map<string, number>();
  for (const item of list) {
    nameCounts.set(item.name, (nameCounts.get(item.name) ?? 0) + 1);
  }
  const needsDisambiguation = new Set<string>();
  for (const item of list) {
    if ((nameCounts.get(item.name) ?? 0) > 1) {
      needsDisambiguation.add(item.id);
    }
  }

  const labels = new Map<string, string>();
  const resolvePass = (): boolean => {
    labels.clear();
    let changed = false;
    for (const item of list) {
      if (!needsDisambiguation.has(item.id)) {
        labels.set(item.id, item.name);
        continue;
      }
      const sameNameOthers = list.filter(
        (other) => other.id !== item.id && other.name === item.name,
      );
      const otherRawNames = new Set(
        list.filter((other) => other.id !== item.id).map((other) => other.name),
      );
      let candidate = `${item.name} (${item.id})`;
      let len = Math.min(8, item.id.length);
      while (len <= item.id.length) {
        const prefix = item.id.slice(0, len);
        const formatted = `${item.name} (${prefix})`;
        const prefixClash = sameNameOthers.some((other) => other.id.slice(0, len) === prefix);
        const rawNameClash = otherRawNames.has(formatted);
        if (!prefixClash && !rawNameClash) {
          candidate = formatted;
          break;
        }
        if (len >= item.id.length) {
          for (const other of list) {
            if (
              other.id !== item.id &&
              other.name === formatted &&
              !needsDisambiguation.has(other.id)
            ) {
              needsDisambiguation.add(other.id);
              changed = true;
            }
          }
          candidate = formatted;
          break;
        }
        len = Math.min(item.id.length, len + 4);
      }
      labels.set(item.id, candidate);
    }
    const seen = new Map<string, string>();
    for (const item of list) {
      const label = labels.get(item.id) ?? item.name;
      const existingId = seen.get(label);
      if (existingId && existingId !== item.id) {
        if (!needsDisambiguation.has(item.id)) {
          needsDisambiguation.add(item.id);
          changed = true;
        }
        if (!needsDisambiguation.has(existingId)) {
          needsDisambiguation.add(existingId);
          changed = true;
        }
      } else {
        seen.set(label, item.id);
      }
    }
    return changed;
  };

  while (resolvePass()) {
    // Recompute until every label is distinct across raw names and prefixes.
  }

  return labels.get(entity.id) ?? entity.name;
}

export function formatDeviceDisplayName(
  device: Pick<DeviceSummary, "id" | "name">,
  allDevices: readonly Pick<DeviceSummary, "id" | "name">[],
): string {
  return formatUniqueDisplayName(device, allDevices);
}

export function formatPanelDisplayName(
  panel: Pick<PanelSummary, "id" | "name">,
  allPanels: readonly Pick<PanelSummary, "id" | "name">[],
): string {
  return formatUniqueDisplayName(panel, allPanels);
}

export class EditorApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "EditorApiError";
    this.status = status;
  }
}

export function isConflictError(error: unknown): boolean {
  return error instanceof EditorApiError && error.status === 409;
}

export type DraftStatus = {
  kind: "none" | "dirty" | "saved";
  label: string;
  detail: string | null;
};

export function deriveDraftStatus(params: {
  hasPanel: boolean;
  dirty: boolean;
  draftRevision: number | null;
}): DraftStatus {
  if (!params.hasPanel || params.draftRevision === null) {
    return {
      kind: "none",
      label: "Selecione ou crie um painel",
      detail: null,
    };
  }
  if (params.dirty) {
    return {
      kind: "dirty",
      label: "Alterações não salvas",
      detail: `Base r${params.draftRevision} · alterações apenas no navegador até salvar`,
    };
  }
  return {
    kind: "saved",
    label: "Rascunho salvo",
    detail: `Revisão r${params.draftRevision}`,
  };
}

export type LegacyFallbackStatus = {
  status: "idle" | "loading" | "ready" | "error";
  publishedRevision: string | null;
};

export type DeviceActiveStatus = {
  kind:
    | "no-device"
    | "none-sent"
    | "checking-legacy"
    | "legacy-error"
    | "legacy-active"
    | "pending"
    | "confirmed";
  label: string;
  activePanelId: string | null;
  activePanelName: string | null;
  sentRevision: string | null;
  appliedRevision: string | null;
};

export function deriveDeviceActiveStatus(params: {
  device: DeviceSummary | null;
  activePanelName: string | null;
  legacyFallback?: LegacyFallbackStatus;
}): DeviceActiveStatus {
  const { device, activePanelName, legacyFallback } = params;
  if (!device) {
    return {
      kind: "no-device",
      label: "Nenhum dispositivo selecionado",
      activePanelId: null,
      activePanelName: null,
      sentRevision: null,
      appliedRevision: null,
    };
  }
  if (!device.activePanelId) {
    if (legacyFallback?.status === "loading") {
      return {
        kind: "checking-legacy",
        label: "Verificando publicação do dispositivo…",
        activePanelId: null,
        activePanelName: null,
        sentRevision: null,
        appliedRevision: device.appliedRevision,
      };
    }
    if (legacyFallback?.status === "error") {
      return {
        kind: "legacy-error",
        label: "Falha ao consultar publicação legada",
        activePanelId: null,
        activePanelName: null,
        sentRevision: null,
        appliedRevision: device.appliedRevision,
      };
    }
    const legacySentRevision =
      legacyFallback?.status === "ready" && legacyFallback.publishedRevision
        ? legacyFallback.publishedRevision
        : null;
    if (legacySentRevision) {
      const legacyConfirmed = device.appliedRevision === legacySentRevision;
      return {
        kind: "legacy-active",
        label: legacyConfirmed
          ? "Publicação legada confirmada pelo dispositivo"
          : "Publicação legada ativa (aguardando confirmação da versão)",
        activePanelId: null,
        activePanelName: null,
        sentRevision: legacySentRevision,
        appliedRevision: device.appliedRevision,
      };
    }
    return {
      kind: "none-sent",
      label: "Nenhuma publicação enviada",
      activePanelId: null,
      activePanelName: null,
      sentRevision: null,
      appliedRevision: device.appliedRevision,
    };
  }
  if (!device.activePanelVersionId) {
    return {
      kind: "none-sent",
      label: "Nenhuma publicação enviada",
      activePanelId: null,
      activePanelName: null,
      sentRevision: null,
      appliedRevision: device.appliedRevision,
    };
  }
  const sentRevision = `online:${device.activePanelVersionId}`;
  const confirmed = device.appliedRevision === sentRevision;
  return {
    kind: confirmed ? "confirmed" : "pending",
    label: confirmed ? "Versão enviada confirmada" : "Aguardando confirmação",
    activePanelId: device.activePanelId,
    activePanelName,
    sentRevision,
    appliedRevision: device.appliedRevision,
  };
}

export type PublicationStateKind =
  | "no-panel"
  | "no-device"
  | "none-sent"
  | "checking-legacy"
  | "legacy-error"
  | "legacy-fallback-active"
  | "other-panel-active"
  | "pending-confirmation"
  | "confirmed";

export type PublicationState = {
  kind: PublicationStateKind;
  label: string;
  description: string;
  availableInDevice: boolean;
  draftDivergesConfirmed: boolean;
  activePanelId: string | null;
  activePanelName: string | null;
  sentRevision: string | null;
  appliedRevision: string | null;
  otherPanelConfirmed: boolean | null;
};

export function derivePublicationState(params: {
  editingPanelId: string | null;
  editingPanelName: string | null;
  dirty: boolean;
  selectedDevice: DeviceSummary | null;
  activePanelName: string | null;
  availablePanels: PanelAccessItem[];
  accessLoaded?: boolean;
  legacyFallback?: LegacyFallbackStatus;
}): PublicationState {
  const {
    editingPanelId,
    editingPanelName,
    dirty,
    selectedDevice,
    activePanelName,
    availablePanels,
    accessLoaded = true,
    legacyFallback,
  } = params;

  if (!editingPanelId) {
    return {
      kind: "no-panel",
      label: "Nenhum painel em edição",
      description: "Crie ou selecione um painel para editar, salvar rascunho ou publicar.",
      availableInDevice: false,
      draftDivergesConfirmed: false,
      activePanelId: null,
      activePanelName: null,
      sentRevision: null,
      appliedRevision: null,
      otherPanelConfirmed: null,
    };
  }

  if (!selectedDevice) {
    return {
      kind: "no-device",
      label: "Nenhum dispositivo selecionado",
      description:
        "Selecione um dispositivo para acompanhar publicações ou enviar este painel. Você pode editar e salvar o rascunho sem dispositivo.",
      availableInDevice: false,
      draftDivergesConfirmed: false,
      activePanelId: null,
      activePanelName: null,
      sentRevision: null,
      appliedRevision: null,
      otherPanelConfirmed: null,
    };
  }

  const availableInDevice =
    accessLoaded && availablePanels.some((item) => item.panelId === editingPanelId);
  const deviceStatus = deriveDeviceActiveStatus({
    device: selectedDevice,
    activePanelName,
    legacyFallback,
  });

  if (deviceStatus.kind === "none-sent") {
    return {
      kind: "none-sent",
      label: "Nenhuma publicação enviada",
      description: !accessLoaded
        ? `"${selectedDevice.name}" ainda não recebeu nenhuma publicação para exibição.`
        : availableInDevice
          ? `"${selectedDevice.name}" ainda não tem um painel enviado para exibição, mas "${editingPanelName ?? "este painel"}" já está disponibilizado para escolha no tablet.`
          : `"${selectedDevice.name}" ainda não recebeu nenhuma publicação para exibição.`,
      availableInDevice,
      draftDivergesConfirmed: false,
      activePanelId: null,
      activePanelName: null,
      sentRevision: null,
      appliedRevision: selectedDevice.appliedRevision,
      otherPanelConfirmed: null,
    };
  }

  if (deviceStatus.kind === "checking-legacy") {
    return {
      kind: "checking-legacy",
      label: "Verificando publicação do dispositivo…",
      description: `Consultando se "${selectedDevice.name}" já possui uma publicação legada ativa.${
        accessLoaded && availableInDevice
          ? ` "${editingPanelName ?? "Este painel"}" já está disponibilizado para escolha no tablet.`
          : ""
      }`,
      availableInDevice,
      draftDivergesConfirmed: false,
      activePanelId: null,
      activePanelName: null,
      sentRevision: null,
      appliedRevision: deviceStatus.appliedRevision,
      otherPanelConfirmed: null,
    };
  }

  if (deviceStatus.kind === "legacy-error") {
    return {
      kind: "legacy-error",
      label: "Erro ao verificar publicação do dispositivo",
      description: `Não foi possível verificar se "${selectedDevice.name}" mantém uma publicação legada ativa. Use “Atualizar” na área de dispositivos para conferir.`,
      availableInDevice,
      draftDivergesConfirmed: false,
      activePanelId: null,
      activePanelName: null,
      sentRevision: null,
      appliedRevision: deviceStatus.appliedRevision,
      otherPanelConfirmed: null,
    };
  }

  if (deviceStatus.kind === "legacy-active") {
    const legacyConfirmed = Boolean(
      deviceStatus.sentRevision && deviceStatus.appliedRevision === deviceStatus.sentRevision,
    );
    const availabilityNote = !accessLoaded
      ? ""
      : availableInDevice
        ? ` O painel em edição ("${editingPanelName ?? "atual"}") está disponibilizado para seleção no tablet, mas não está definido como painel ativo.`
        : ` O painel em edição ("${editingPanelName ?? "atual"}") ainda não foi disponibilizado neste dispositivo.`;
    return {
      kind: "legacy-fallback-active",
      label: "Publicação legada ativa no dispositivo",
      description: legacyConfirmed
        ? `"${selectedDevice.name}" não tem um painel ativo vinculado, mas mantém e confirmou uma publicação legada em exibição (e não o rascunho em edição).${availabilityNote}`
        : `"${selectedDevice.name}" não tem um painel ativo vinculado, mas possui uma publicação legada em exibição aguardando confirmação da versão atual (e não o rascunho em edição).${availabilityNote}`,
      availableInDevice,
      draftDivergesConfirmed: false,
      activePanelId: null,
      activePanelName: null,
      sentRevision: deviceStatus.sentRevision,
      appliedRevision: deviceStatus.appliedRevision,
      otherPanelConfirmed: legacyConfirmed,
    };
  }

  if (deviceStatus.activePanelId !== editingPanelId) {
    const otherName = activePanelName ?? "Outro painel";
    const otherConfirmed = deviceStatus.kind === "confirmed";
    const availabilityNote = !accessLoaded
      ? ""
      : availableInDevice
        ? ` O painel em edição ("${editingPanelName ?? "atual"}") está disponibilizado para seleção no tablet, mas não é o painel ativo.`
        : ` O painel em edição ("${editingPanelName ?? "atual"}") ainda não foi disponibilizado neste dispositivo.`;
    return {
      kind: "other-panel-active",
      label: `Outro painel ativo no dispositivo: ${otherName}`,
      description: otherConfirmed
        ? `O dispositivo confirmou a exibição de "${otherName}", e não do rascunho em edição.${availabilityNote}`
        : `"${otherName}" foi enviado para exibição e aguarda confirmação do dispositivo.${availabilityNote}`,
      availableInDevice,
      draftDivergesConfirmed: false,
      activePanelId: deviceStatus.activePanelId,
      activePanelName: otherName,
      sentRevision: deviceStatus.sentRevision,
      appliedRevision: deviceStatus.appliedRevision,
      otherPanelConfirmed: otherConfirmed,
    };
  }

  if (deviceStatus.kind === "pending") {
    return {
      kind: "pending-confirmation",
      label: "Aguardando confirmação",
      description:
        deviceStatus.appliedRevision && deviceStatus.appliedRevision !== deviceStatus.sentRevision
          ? `Uma nova versão deste painel foi enviada a "${selectedDevice.name}"; o tablet ainda reporta uma versão anterior aplicada.`
          : `Publicação enviada para "${selectedDevice.name}"; aguardando o tablet confirmar que aplicou a versão.`,
      availableInDevice,
      draftDivergesConfirmed: false,
      activePanelId: deviceStatus.activePanelId,
      activePanelName: editingPanelName ?? activePanelName,
      sentRevision: deviceStatus.sentRevision,
      appliedRevision: deviceStatus.appliedRevision,
      otherPanelConfirmed: null,
    };
  }

  return {
    kind: "confirmed",
    label: "Versão enviada confirmada",
    description: dirty
      ? `O dispositivo "${selectedDevice.name}" confirmou a última versão enviada deste painel, mas o rascunho atual possui alterações não salvas que ainda não foram publicadas.`
      : `O dispositivo "${selectedDevice.name}" confirmou a versão enviada deste painel. Essa confirmação não garante equivalência caso o rascunho tenha sido salvo após a publicação.`,
    availableInDevice,
    draftDivergesConfirmed: dirty,
    activePanelId: deviceStatus.activePanelId,
    activePanelName: editingPanelName ?? activePanelName,
    sentRevision: deviceStatus.sentRevision,
    appliedRevision: deviceStatus.appliedRevision,
    otherPanelConfirmed: null,
  };
}

export type DevicePanelEntry = {
  panelId: string;
  name: string;
  versionId: string;
  isActive: boolean;
};

export function splitDevicePanelAvailability(params: {
  panels: PanelSummary[];
  access: PanelAccessItem[];
  activePanelId: string | null;
}) {
  const byPanelId = new Map(params.access.map((item) => [item.panelId, item.versionId]));
  const available: DevicePanelEntry[] = [];
  const unavailable: PanelSummary[] = [];

  for (const panel of params.panels) {
    const displayPanel: PanelSummary = {
      id: panel.id,
      name: formatPanelDisplayName(panel, params.panels),
    };
    const versionId = byPanelId.get(panel.id);
    if (versionId) {
      available.push({
        panelId: displayPanel.id,
        name: displayPanel.name,
        versionId,
        isActive: panel.id === params.activePanelId,
      });
    } else {
      unavailable.push(displayPanel);
    }
  }

  const foundActive =
    params.activePanelId !== null
      ? (params.panels.find((panel) => panel.id === params.activePanelId) ?? null)
      : null;
  const activePanel = foundActive
    ? { id: foundActive.id, name: formatPanelDisplayName(foundActive, params.panels) }
    : null;

  return { activePanel, available, unavailable };
}

export function isPairingExpired(
  pairing: Pick<PairingInfo, "expiresAt">,
  nowMs = Date.now(),
): boolean {
  const expiresAtMs = Date.parse(pairing.expiresAt);
  if (Number.isNaN(expiresAtMs)) return true;
  return nowMs >= expiresAtMs;
}

export function formatLastCommunication(lastSeenAt: string | null): string {
  if (!lastSeenAt) return "Sem registro de comunicação";
  const parsed = new Date(lastSeenAt);
  if (Number.isNaN(parsed.getTime())) return "Sem registro de comunicação";
  return `Última comunicação: ${parsed.toLocaleString("pt-BR")}`;
}

export function formatPartialPublishFailure(params: {
  savedRevision: number;
  deviceName: string;
  failure: unknown;
}): { message: string; isConflict: boolean; uncertainOutcome: boolean } {
  const conflict = isConflictError(params.failure);
  const detail =
    params.failure instanceof Error && params.failure.message
      ? params.failure.message
      : "Falha ao enviar publicação.";
  if (conflict) {
    return {
      isConflict: true,
      uncertainOutcome: false,
      message: `O rascunho foi salvo (r${params.savedRevision}), mas houve conflito de revisão ao publicar para "${params.deviceName}". Recarregue o painel e tente publicar novamente.`,
    };
  }
  const definiteClientRejection =
    params.failure instanceof EditorApiError &&
    params.failure.status >= 400 &&
    params.failure.status < 500;
  if (definiteClientRejection) {
    return {
      isConflict: false,
      uncertainOutcome: false,
      message: `O rascunho foi salvo (r${params.savedRevision}), mas a publicação para "${params.deviceName}" foi recusada: ${detail} Nenhuma publicação foi aplicada ao dispositivo.`,
    };
  }
  return {
    isConflict: false,
    uncertainOutcome: true,
    message: `O rascunho foi salvo (r${params.savedRevision}), mas a publicação para "${params.deviceName}" falhou sem confirmação de entrega: ${detail} Atualize os dispositivos para conferir se a publicação foi aplicada antes de tentar novamente.`,
  };
}
