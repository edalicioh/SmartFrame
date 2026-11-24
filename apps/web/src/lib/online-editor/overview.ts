import {
  deriveDeviceActiveStatus,
  formatDeviceDisplayName,
  formatLastCommunication,
  formatPanelDisplayName,
  type DeviceActiveStatus,
  type DeviceSummary,
  type PanelSummary,
} from "./publication";

export const OVERVIEW_DEVICES_LIMIT = 12;
export const OVERVIEW_PANELS_LIMIT = 12;
export const OVERVIEW_PHOTOS_LIMIT = 6;

export function isEligiblePanelKey(key: string | null | undefined): boolean {
  if (!key) return false;
  return key.startsWith("panel:") || key.startsWith("online:");
}

export function normalizeEditorSearchParam(value: string | string[] | undefined): string | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (typeof candidate !== "string") return null;
  const trimmed = candidate.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function buildEditorShortcutHref(params: {
  panelId?: string | null;
  deviceId?: string | null;
}): string {
  const search = new URLSearchParams();
  if (params.panelId) search.set("panelId", params.panelId);
  if (params.deviceId) search.set("deviceId", params.deviceId);
  const query = search.toString();
  return query ? `/layouts?${query}` : "/layouts";
}

export function resolveInitialPanelSelection(
  initialPanelId: string | null,
  panels: readonly Pick<PanelSummary, "id">[],
): { panelId: string | null; notice: string | null } {
  if (!initialPanelId) return { panelId: null, notice: null };
  if (panels.some((panel) => panel.id === initialPanelId)) {
    return { panelId: initialPanelId, notice: null };
  }
  return {
    panelId: null,
    notice: "O painel solicitado no atalho não foi encontrado nesta conta. Selecione um painel para editar.",
  };
}

export function resolveInitialDeviceSelection(
  initialDeviceId: string | null,
  devices: readonly Pick<DeviceSummary, "id">[],
): { deviceId: string | null; notice: string | null } {
  if (!initialDeviceId) return { deviceId: null, notice: null };
  if (devices.some((device) => device.id === initialDeviceId)) {
    return { deviceId: initialDeviceId, notice: null };
  }
  return {
    deviceId: null,
    notice: "O dispositivo solicitado no atalho não foi encontrado ou foi desvinculado.",
  };
}

export function resolveInitialEditorSelection(params: {
  initialPanelId: string | null;
  initialDeviceId: string | null;
  panels: readonly Pick<PanelSummary, "id">[];
  devices: readonly Pick<DeviceSummary, "id">[];
}): { panelId: string | null; deviceId: string | null; fallbackNotice: string | null } {
  const panelResult = resolveInitialPanelSelection(params.initialPanelId, params.panels);
  const deviceResult = resolveInitialDeviceSelection(params.initialDeviceId, params.devices);
  const notices = [panelResult.notice, deviceResult.notice].filter((item): item is string =>
    Boolean(item),
  );
  return {
    panelId: panelResult.panelId,
    deviceId: deviceResult.deviceId,
    fallbackNotice: notices.length > 0 ? notices.join(" ") : null,
  };
}

export function formatListCountLabel(
  shown: number,
  total: number,
  singular: string,
  plural: string,
): string {
  if (total === 0) return `0 ${plural}`;
  if (total > shown) return `Exibindo ${shown} de ${total} ${plural}`;
  return total === 1 ? `1 ${singular}` : `${total} ${plural}`;
}

export type OverviewDeviceCard = {
  id: string;
  displayName: string;
  lastCommunicationLabel: string;
  hasCommunicationRecord: boolean;
  statusKind: DeviceActiveStatus["kind"];
  statusLabel: string;
  activePanelName: string | null;
  isLegacyFallback: boolean;
  nextStepLabel: string;
  editorHref: string;
};

export function mapOverviewDeviceCard(params: {
  device: DeviceSummary;
  allDevices: readonly DeviceSummary[];
  activePanel: PanelSummary | null;
  allPanels: readonly PanelSummary[];
  legacyPanel: { id: string; name: string; publishedVersionId: string } | null;
  totalPanels: number;
}): OverviewDeviceCard {
  const { device, allDevices, activePanel, allPanels, legacyPanel, totalPanels } = params;
  const displayName = formatDeviceDisplayName(device, allDevices);
  const resolvedPanelName = activePanel ? formatPanelDisplayName(activePanel, allPanels) : null;
  const resolvedLegacyName = legacyPanel
    ? formatPanelDisplayName({ id: legacyPanel.id, name: legacyPanel.name }, allPanels)
    : null;
  const deviceStatus = deriveDeviceActiveStatus({
    device,
    activePanelName: resolvedPanelName,
    legacyFallback: legacyPanel
      ? { status: "ready", publishedRevision: `online:${legacyPanel.publishedVersionId}` }
      : { status: "ready", publishedRevision: null },
  });

  let activePanelDisplayName: string | null = null;
  let shortcutPanelId: string | null = null;
  let nextStepLabel = "Personalizar neste dispositivo";

  if (deviceStatus.kind === "confirmed") {
    activePanelDisplayName = resolvedPanelName ?? "Painel ativo";
    shortcutPanelId = deviceStatus.activePanelId;
    nextStepLabel = "Abrir painel e dispositivo no editor";
  } else if (deviceStatus.kind === "pending") {
    activePanelDisplayName = resolvedPanelName ?? "Painel ativo";
    shortcutPanelId = deviceStatus.activePanelId;
    nextStepLabel = "Acompanhar confirmação no editor";
  } else if (deviceStatus.kind === "legacy-active") {
    activePanelDisplayName = resolvedLegacyName ?? "Publicação legada (fallback)";
    shortcutPanelId = legacyPanel?.id ?? null;
    nextStepLabel = "Gerenciar painel legado no editor";
  } else {
    nextStepLabel =
      totalPanels > 0
        ? "Escolha ou envie um painel para este dispositivo no editor."
        : "Crie um painel no editor e publique para este dispositivo.";
  }

  return {
    id: device.id,
    displayName,
    lastCommunicationLabel: formatLastCommunication(device.lastSeenAt, device.timezone),
    hasCommunicationRecord: Boolean(device.lastSeenAt),
    statusKind: deviceStatus.kind,
    statusLabel: deviceStatus.label,
    activePanelName: activePanelDisplayName,
    isLegacyFallback: deviceStatus.kind === "legacy-active",
    nextStepLabel,
    editorHref: buildEditorShortcutHref({
      panelId: shortcutPanelId,
      deviceId: device.id,
    }),
  };
}

export type OverviewPanelCard = {
  id: string;
  displayName: string;
  draftRevision: number;
  statusLabel: string;
  badgeLabel: string;
  badgeTone: "confirmed" | "pending" | "none";
  activeDeviceCount: number;
  availableDeviceCount: number;
  hasPublishedVersion: boolean;
  editorHref: string;
};

export function mapOverviewPanelCard(params: {
  panel: PanelSummary & {
    draftRevision: number;
    hasPublishedVersion: boolean;
    activeDeviceCount: number;
    availableDeviceCount?: number;
    extraAvailableDeviceCount?: number;
  };
  allPanels: readonly PanelSummary[];
}): OverviewPanelCard {
  const { panel, allPanels } = params;
  const displayName = formatPanelDisplayName(panel, allPanels);
  const availableDeviceCount = panel.availableDeviceCount ?? 0;
  const extraAvailableDeviceCount =
    panel.extraAvailableDeviceCount ??
    Math.max(0, availableDeviceCount - panel.activeDeviceCount);

  let badgeLabel = "Rascunho";
  let badgeTone: OverviewPanelCard["badgeTone"] = "none";
  let statusLabel = "Somente rascunho";

  if (panel.activeDeviceCount > 0) {
    badgeLabel = `${panel.activeDeviceCount} ativo`;
    badgeTone = "confirmed";
    const sentText = `Enviado para ${panel.activeDeviceCount} ${
      panel.activeDeviceCount === 1 ? "dispositivo" : "dispositivos"
    }`;
    statusLabel =
      extraAvailableDeviceCount > 0
        ? `${sentText} · disponibilizado em mais ${extraAvailableDeviceCount} ${
            extraAvailableDeviceCount === 1 ? "dispositivo" : "dispositivos"
          }`
        : sentText;
  } else if (availableDeviceCount > 0) {
    badgeLabel = "Disponibilizado";
    badgeTone = "pending";
    statusLabel = `Versão disponibilizada em ${availableDeviceCount} ${
      availableDeviceCount === 1 ? "dispositivo" : "dispositivos"
    } (sem envio ativo)`;
  } else if (panel.hasPublishedVersion) {
    badgeLabel = "Publicado";
    badgeTone = "pending";
    statusLabel = "Com versão publicada (sem envio ativo)";
  }

  return {
    id: panel.id,
    displayName,
    draftRevision: panel.draftRevision,
    statusLabel,
    badgeLabel,
    badgeTone,
    activeDeviceCount: panel.activeDeviceCount,
    availableDeviceCount,
    hasPublishedVersion: panel.hasPublishedVersion,
    editorHref: buildEditorShortcutHref({ panelId: panel.id }),
  };
}

export function shouldRetryDeviceListRefresh(params: {
  requestedIncludeId: string | null;
  currentTargetId: string | null;
  receivedDeviceIds: readonly string[];
  retries: number;
  maxRetries?: number;
}): boolean {
  const maxRetries = params.maxRetries ?? 2;
  if (!params.currentTargetId || params.retries >= maxRetries) return false;
  if (params.currentTargetId === params.requestedIncludeId) return false;
  return !params.receivedDeviceIds.includes(params.currentTargetId);
}

export type OverviewNextStep = {
  key: string;
  title: string;
  description: string;
  ctaLabel: string;
  href: string;
  optional: boolean;
};

export type OverviewGuidance = {
  mode: "empty" | "partial" | "active";
  headline: string;
  summary: string;
  primaryCta: { label: string; href: string };
  steps: OverviewNextStep[];
};

export function deriveOverviewGuidance(params: {
  totalPanels: number;
  totalDevices: number;
  totalPhotos: number;
  readyPhotos: number;
  pendingPhotos: number;
  devicesWithoutPanel: number;
  devicesPendingConfirmation: number;
  firstPanelId?: string | null;
  firstDeviceWithoutPanelId?: string | null;
}): OverviewGuidance {
  const {
    totalPanels,
    totalDevices,
    totalPhotos,
    readyPhotos,
    pendingPhotos,
    devicesWithoutPanel,
    devicesPendingConfirmation,
    firstPanelId = null,
    firstDeviceWithoutPanelId = null,
  } = params;

  const steps: OverviewNextStep[] = [];

  if (totalPanels === 0) {
    steps.push({
      key: "create-panel",
      title: "Crie seu primeiro painel",
      description:
        "Monte um painel com widgets e rascunhos salvos no servidor antes mesmo de vincular um tablet.",
      ctaLabel: "Criar painel no editor",
      href: "/layouts",
      optional: false,
    });
  }

  if (totalPhotos === 0) {
    steps.push({
      key: "add-photos",
      title: "Adicione fotos à biblioteca (opcional)",
      description:
        "Você pode enviar imagens para exibir em carrossel, ou usar painéis apenas com widgets como relógio, clima, tarefas e recados.",
      ctaLabel: "Abrir biblioteca no editor",
      href: buildEditorShortcutHref({ panelId: firstPanelId }),
      optional: true,
    });
  }

  if (totalDevices === 0) {
    steps.push({
      key: "pair-device",
      title: "Vincule um tablet quando estiver pronto",
      description:
        "A criação e a edição de rascunhos já funcionam normalmente. Para publicar, gere um código na área Dispositivos, permissões e pareamento do editor.",
      ctaLabel: "Abrir pareamento no editor",
      href: buildEditorShortcutHref({ panelId: firstPanelId }),
      optional: false,
    });
  }

  if (totalPanels === 0 && totalDevices === 0 && totalPhotos === 0) {
    return {
      mode: "empty",
      headline: "Comece criando seu primeiro painel",
      summary:
        "Organize seu painel no editor, adicione fotos se desejar e vincule um tablet quando quiser publicar.",
      primaryCta: { label: "Criar primeiro painel", href: "/layouts" },
      steps,
    };
  }

  if (totalPanels === 0 || totalDevices === 0) {
    const summaryParts: string[] = [];
    if (totalPanels === 0) {
      summaryParts.push("ainda falta criar o primeiro painel");
    }
    if (totalDevices === 0) {
      summaryParts.push("você já pode editar e salvar rascunhos enquanto prepara o pareamento do tablet");
    }
    return {
      mode: "partial",
      headline: "Próximos passos da sua instalação",
      summary: summaryParts.length
        ? `${summaryParts[0].charAt(0).toUpperCase()}${summaryParts.join("; ").slice(1)}.`
        : "Continue a configuração do seu espaço no editor.",
      primaryCta: {
        label: totalPanels === 0 ? "Criar primeiro painel" : "Abrir editor",
        href: buildEditorShortcutHref({ panelId: firstPanelId }),
      },
      steps,
    };
  }

  if (devicesWithoutPanel > 0) {
    steps.push({
      key: "assign-panel",
      title: `${devicesWithoutPanel} ${
        devicesWithoutPanel === 1 ? "dispositivo ainda sem painel enviado" : "dispositivos ainda sem painel enviado"
      }`,
      description:
        "Selecione o painel desejado no editor e escolha entre disponibilizar ou enviar para exibição imediata.",
      ctaLabel: "Escolher painel no editor",
      href: buildEditorShortcutHref({
        panelId: firstPanelId,
        deviceId: firstDeviceWithoutPanelId,
      }),
      optional: false,
    });
  } else if (devicesPendingConfirmation > 0) {
    steps.push({
      key: "pending-confirmation",
      title: `${devicesPendingConfirmation} ${
        devicesPendingConfirmation === 1
          ? "dispositivo aguardando confirmação"
          : "dispositivos aguardando confirmação"
      }`,
      description:
        "A publicação foi enviada; o estado mudará para confirmado quando o tablet aplicar a versão.",
      ctaLabel: "Acompanhar no editor",
      href: "/layouts",
      optional: false,
    });
  } else if (totalPhotos > 0 && readyPhotos === 0 && pendingPhotos > 0) {
    steps.push({
      key: "processing-photos",
      title: "Fotos em processamento",
      description:
        "Há imagens enviadas aguardando otimização antes de ficarem disponíveis para seleção nos painéis.",
      ctaLabel: "Ver biblioteca no editor",
      href: buildEditorShortcutHref({ panelId: firstPanelId }),
      optional: true,
    });
  }

  return {
    mode: "active",
    headline: "Visão operacional",
    summary:
      "Gerencie seus dispositivos vinculados, abra rascunhos de painéis e acompanhe as publicações enviadas.",
    primaryCta: { label: "Personalizar painéis", href: "/layouts" },
    steps,
  };
}
