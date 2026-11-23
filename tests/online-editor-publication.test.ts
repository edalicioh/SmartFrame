import { describe, expect, it } from "vitest";
import {
  deriveDeviceActiveStatus,
  deriveDraftStatus,
  derivePublicationState,
  EditorApiError,
  formatDeviceDisplayName,
  formatLastCommunication,
  formatPanelDisplayName,
  formatPartialPublishFailure,
  isConflictError,
  isPairingExpired,
  splitDevicePanelAvailability,
  type DeviceSummary,
} from "../apps/web/src/lib/online-editor/publication";

const baseDevice: DeviceSummary = {
  id: "dev-1",
  name: "Tablet Sala",
  lastSeenAt: "2026-11-23T09:00:00.000Z",
  appliedRevision: null,
  activePanelId: null,
  activePanelVersionId: null,
};

describe("online editor publication derived states", () => {
  it("distingue ausência de painel, alterações não salvas e rascunho salvo", () => {
    expect(deriveDraftStatus({ hasPanel: false, dirty: false, draftRevision: null })).toEqual({
      kind: "none",
      label: "Selecione ou crie um painel",
      detail: null,
    });

    expect(deriveDraftStatus({ hasPanel: true, dirty: true, draftRevision: 4 })).toMatchObject({
      kind: "dirty",
      label: "Alterações não salvas",
    });

    expect(deriveDraftStatus({ hasPanel: true, dirty: false, draftRevision: 4 })).toEqual({
      kind: "saved",
      label: "Rascunho salvo",
      detail: "Revisão r4",
    });
  });

  it("retorna estado explícito quando não há painel selecionado", () => {
    const result = derivePublicationState({
      editingPanelId: null,
      editingPanelName: null,
      dirty: false,
      selectedDevice: baseDevice,
      activePanelName: null,
      availablePanels: [],
    });
    expect(result.kind).toBe("no-panel");
    expect(result.label).toBe("Nenhum painel em edição");
    expect(result.availableInDevice).toBe(false);
  });

  it("retorna sem destino quando não há dispositivo selecionado", () => {
    const result = derivePublicationState({
      editingPanelId: "panel-a",
      editingPanelName: "Painel A",
      dirty: false,
      selectedDevice: null,
      activePanelName: null,
      availablePanels: [],
    });
    expect(result.kind).toBe("no-device");
    expect(result.label).toBe("Nenhum dispositivo selecionado");
  });

  it("retorna nenhuma publicação enviada quando o dispositivo não tem versão ativa", () => {
    const result = derivePublicationState({
      editingPanelId: "panel-a",
      editingPanelName: "Painel A",
      dirty: false,
      selectedDevice: baseDevice,
      activePanelName: null,
      availablePanels: [{ panelId: "panel-a", versionId: "v1" }],
    });
    expect(result.kind).toBe("none-sent");
    expect(result.label).toBe("Nenhuma publicação enviada");
    expect(result.availableInDevice).toBe(true);
  });

  it("retorna aguardando confirmação quando appliedRevision está ausente (pendente)", () => {
    const result = derivePublicationState({
      editingPanelId: "panel-a",
      editingPanelName: "Painel A",
      dirty: false,
      selectedDevice: {
        ...baseDevice,
        activePanelId: "panel-a",
        activePanelVersionId: "v2",
        appliedRevision: null,
      },
      activePanelName: "Painel A",
      availablePanels: [{ panelId: "panel-a", versionId: "v2" }],
    });
    expect(result.kind).toBe("pending-confirmation");
    expect(result.label).toBe("Aguardando confirmação");
    expect(result.sentRevision).toBe("online:v2");
    expect(result.appliedRevision).toBeNull();
  });

  it("retorna aguardando confirmação quando a revisão aplicada difere da enviada", () => {
    const result = derivePublicationState({
      editingPanelId: "panel-a",
      editingPanelName: "Painel A",
      dirty: false,
      selectedDevice: {
        ...baseDevice,
        activePanelId: "panel-a",
        activePanelVersionId: "v2",
        appliedRevision: "online:v1",
      },
      activePanelName: "Painel A",
      availablePanels: [{ panelId: "panel-a", versionId: "v2" }],
    });
    expect(result.kind).toBe("pending-confirmation");
    expect(result.label).toBe("Aguardando confirmação");
    expect(result.sentRevision).toBe("online:v2");
    expect(result.appliedRevision).toBe("online:v1");
  });

  it("retorna versão enviada confirmada somente quando revisão aplicada iguala enviada no mesmo painel", () => {
    const result = derivePublicationState({
      editingPanelId: "panel-a",
      editingPanelName: "Painel A",
      dirty: false,
      selectedDevice: {
        ...baseDevice,
        activePanelId: "panel-a",
        activePanelVersionId: "v2",
        appliedRevision: "online:v2",
      },
      activePanelName: "Painel A",
      availablePanels: [{ panelId: "panel-a", versionId: "v2" }],
    });
    expect(result.kind).toBe("confirmed");
    expect(result.label).toBe("Versão enviada confirmada");
    expect(result.draftDivergesConfirmed).toBe(false);
    expect(result.description).toContain("não garante equivalência");
  });

  it("sinaliza divergência quando o rascunho é modificado após confirmação", () => {
    const result = derivePublicationState({
      editingPanelId: "panel-a",
      editingPanelName: "Painel A",
      dirty: true,
      selectedDevice: {
        ...baseDevice,
        activePanelId: "panel-a",
        activePanelVersionId: "v2",
        appliedRevision: "online:v2",
      },
      activePanelName: "Painel A",
      availablePanels: [{ panelId: "panel-a", versionId: "v2" }],
    });
    expect(result.kind).toBe("confirmed");
    expect(result.draftDivergesConfirmed).toBe(true);
    expect(result.description).toContain("alterações não salvas");
  });

  it("não associa confirmação de outro painel ativo ao rascunho em edição", () => {
    const result = derivePublicationState({
      editingPanelId: "panel-a",
      editingPanelName: "Painel A",
      dirty: false,
      selectedDevice: {
        ...baseDevice,
        activePanelId: "panel-b",
        activePanelVersionId: "vb1",
        appliedRevision: "online:vb1",
      },
      activePanelName: "Painel B",
      availablePanels: [
        { panelId: "panel-a", versionId: "va1" },
        { panelId: "panel-b", versionId: "vb1" },
      ],
    });
    expect(result.kind).toBe("other-panel-active");
    expect(result.label).toBe("Outro painel ativo no dispositivo: Painel B");
    expect(result.otherPanelConfirmed).toBe(true);
    expect(result.availableInDevice).toBe(true);
    expect(result.description).toContain("e não do rascunho em edição");

    const deviceActive = deriveDeviceActiveStatus({
      device: {
        ...baseDevice,
        activePanelId: "panel-b",
        activePanelVersionId: "vb1",
        appliedRevision: "online:vb1",
      },
      activePanelName: "Painel B",
    });
    expect(deviceActive.kind).toBe("confirmed");
    expect(deviceActive.activePanelId).toBe("panel-b");

    const pendingOther = derivePublicationState({
      editingPanelId: "panel-a",
      editingPanelName: "Painel A",
      dirty: false,
      selectedDevice: {
        ...baseDevice,
        activePanelId: "panel-b",
        activePanelVersionId: "vb2",
        appliedRevision: "online:vb1",
      },
      activePanelName: "Painel B",
      availablePanels: [{ panelId: "panel-b", versionId: "vb2" }],
    });
    expect(pendingOther.kind).toBe("other-panel-active");
    expect(pendingOther.otherPanelConfirmed).toBe(false);
    expect(pendingOther.availableInDevice).toBe(false);
    expect(pendingOther.description).toContain("aguarda confirmação do dispositivo");
  });

  it("separa painel ativo e painéis disponíveis dos não disponibilizados no destino", () => {
    const split = splitDevicePanelAvailability({
      panels: [
        { id: "p1", name: "Principal" },
        { id: "p2", name: "Reserva" },
        { id: "p3", name: "Rascunho Local" },
      ],
      access: [
        { panelId: "p1", versionId: "v1" },
        { panelId: "p2", versionId: "v2" },
      ],
      activePanelId: "p1",
    });
    expect(split.activePanel).toEqual({ id: "p1", name: "Principal" });
    expect(split.available).toEqual([
      { panelId: "p1", name: "Principal", versionId: "v1", isActive: true },
      { panelId: "p2", name: "Reserva", versionId: "v2", isActive: false },
    ]);
    expect(split.unavailable).toEqual([{ id: "p3", name: "Rascunho Local" }]);
  });

  it("detecta expiração do código de pareamento e formata última comunicação", () => {
    const expiresAt = "2026-11-23T10:00:00.000Z";
    expect(isPairingExpired({ expiresAt }, Date.parse("2026-11-23T09:59:59.000Z"))).toBe(false);
    expect(isPairingExpired({ expiresAt }, Date.parse("2026-11-23T10:00:00.000Z"))).toBe(true);
    expect(isPairingExpired({ expiresAt: "invalid" }, 0)).toBe(true);
    expect(formatLastCommunication(null)).toBe("Sem registro de comunicação");
    expect(formatLastCommunication("2026-11-23T10:00:00.000Z")).toContain("Última comunicação:");
  });

  it("identifica conflito 409 e descreve falha de publicação após salvar rascunho", () => {
    const conflict = new EditorApiError("Conflito", 409);
    expect(isConflictError(conflict)).toBe(true);
    expect(isConflictError(new EditorApiError("Erro", 500))).toBe(false);

    expect(
      formatPartialPublishFailure({
        savedRevision: 7,
        deviceName: "Tablet Cozinha",
        failure: conflict,
      }),
    ).toEqual({
      isConflict: true,
      uncertainOutcome: false,
      message:
        'O rascunho foi salvo (r7), mas houve conflito de revisão ao publicar para "Tablet Cozinha". Recarregue o painel e tente publicar novamente.',
    });

    expect(
      formatPartialPublishFailure({
        savedRevision: 7,
        deviceName: "Tablet Cozinha",
        failure: new EditorApiError("Dados inválidos", 400),
      }),
    ).toEqual({
      isConflict: false,
      uncertainOutcome: false,
      message:
        'O rascunho foi salvo (r7), mas a publicação para "Tablet Cozinha" foi recusada: Dados inválidos Nenhuma publicação foi aplicada ao dispositivo.',
    });

    expect(
      formatPartialPublishFailure({
        savedRevision: 7,
        deviceName: "Tablet Cozinha",
        failure: new Error("Falha de rede"),
      }),
    ).toEqual({
      isConflict: false,
      uncertainOutcome: true,
      message:
        'O rascunho foi salvo (r7), mas a publicação para "Tablet Cozinha" falhou sem confirmação de entrega: Falha de rede Atualize os dispositivos para conferir se a publicação foi aplicada antes de tentar novamente.',
    });
  });

  it("diferencia dispositivos com nomes idênticos usando prefixo de ID não secreto", () => {
    const devices = [
      { id: "12345678-aaaa-bbbb-cccc-000000000001", name: "Tablet Sala" },
      { id: "12345678-bbbb-cccc-dddd-000000000002", name: "Tablet Sala" },
      { id: "99999999-aaaa-bbbb-cccc-000000000003", name: "Tablet Cozinha" },
    ];
    expect(formatDeviceDisplayName(devices[0], devices)).toBe("Tablet Sala (12345678-aaa)");
    expect(formatDeviceDisplayName(devices[1], devices)).toBe("Tablet Sala (12345678-bbb)");
    expect(formatDeviceDisplayName(devices[2], devices)).toBe("Tablet Cozinha");
  });

  it("evita colisão quando outro dispositivo tem nome literal igual ao rótulo sufixado", () => {
    const collidingPrefix = [
      { id: "abcdefgh-one", name: "Tablet" },
      { id: "ijklmnop-two", name: "Tablet" },
      { id: "qrstuvwx-three", name: "Tablet (abcdefgh)" },
    ];
    const prefixLabels = collidingPrefix.map((item) =>
      formatDeviceDisplayName(item, collidingPrefix),
    );
    expect(new Set(prefixLabels).size).toBe(3);
    expect(prefixLabels[0]).toBe("Tablet (abcdefgh-one)");
    expect(prefixLabels[1]).toBe("Tablet (ijklmnop)");
    expect(prefixLabels[2]).toBe("Tablet (abcdefgh)");

    const collidingFullId = [
      { id: "abcdefgh-one", name: "Tablet" },
      { id: "ijklmnop-two", name: "Tablet" },
      { id: "qrstuvwx-three", name: "Tablet (abcdefgh-one)" },
    ];
    const fullIdLabels = collidingFullId.map((item) =>
      formatDeviceDisplayName(item, collidingFullId),
    );
    expect(new Set(fullIdLabels).size).toBe(3);
  });

  it("diferencia painéis homônimos sem colisão em seletores e disponibilidade", () => {
    const panels = [
      { id: "11111111-aaaa-bbbb", name: "Painel Sala" },
      { id: "22222222-cccc-dddd", name: "Painel Sala" },
      { id: "33333333-eeee-ffff", name: "Painel Sala (11111111)" },
    ];
    const labels = panels.map((panel) => formatPanelDisplayName(panel, panels));
    expect(new Set(labels).size).toBe(3);
    expect(labels[0]).toBe("Painel Sala (11111111-aaa)");
    expect(labels[1]).toBe("Painel Sala (22222222)");
    expect(labels[2]).toBe("Painel Sala (11111111)");

    const split = splitDevicePanelAvailability({
      panels,
      access: [{ panelId: "11111111-aaaa-bbbb", versionId: "v1" }],
      activePanelId: "11111111-aaaa-bbbb",
    });
    expect(split.activePanel?.name).toBe("Painel Sala (11111111-aaa)");
    expect(split.available[0]?.name).toBe("Painel Sala (11111111-aaa)");
    expect(split.unavailable.map((item) => item.name)).toEqual([
      "Painel Sala (22222222)",
      "Painel Sala (11111111)",
    ]);

    // When `entity` carries a fresher name (e.g. from state polling) than `allPanels`,
    // `formatPanelDisplayName` uses the fresher name and still disambiguates accurately.
    expect(
      formatPanelDisplayName(
        { id: "11111111-aaaa-bbbb", name: "Renomeado" },
        [
          { id: "11111111-aaaa-bbbb", name: "Painel Sala" },
          { id: "44444444-dddd-eeee", name: "Renomeado" },
        ],
      ),
    ).toBe("Renomeado (11111111)");
  });

  it("não exibe nenhuma publicação enviada quando activePanelId é nulo mas há publicação legada", () => {
    const confirmedLegacy = derivePublicationState({
      editingPanelId: "panel-a",
      editingPanelName: "Painel A",
      dirty: false,
      selectedDevice: {
        ...baseDevice,
        activePanelId: null,
        activePanelVersionId: null,
        appliedRevision: "online:legacy-v1",
      },
      activePanelName: null,
      availablePanels: [{ panelId: "panel-a", versionId: "va1" }],
      legacyFallback: {
        status: "ready",
        publishedRevision: "online:legacy-v1",
      },
    });
    expect(confirmedLegacy.kind).toBe("legacy-fallback-active");
    expect(confirmedLegacy.label).toBe("Publicação legada ativa no dispositivo");
    expect(confirmedLegacy.otherPanelConfirmed).toBe(true);
    expect(confirmedLegacy.sentRevision).toBe("online:legacy-v1");
    expect(confirmedLegacy.appliedRevision).toBe("online:legacy-v1");
    expect(confirmedLegacy.availableInDevice).toBe(true);

    const pendingLegacy = derivePublicationState({
      editingPanelId: "panel-a",
      editingPanelName: "Painel A",
      dirty: false,
      selectedDevice: {
        ...baseDevice,
        activePanelId: null,
        activePanelVersionId: null,
        appliedRevision: null,
      },
      activePanelName: null,
      availablePanels: [],
      legacyFallback: {
        status: "ready",
        publishedRevision: "online:legacy-v2",
      },
    });
    expect(pendingLegacy.kind).toBe("legacy-fallback-active");
    expect(pendingLegacy.otherPanelConfirmed).toBe(false);
    expect(pendingLegacy.sentRevision).toBe("online:legacy-v2");

    const appliedOnlyWithoutResolvedFallback = derivePublicationState({
      editingPanelId: "panel-a",
      editingPanelName: "Painel A",
      dirty: false,
      selectedDevice: {
        ...baseDevice,
        activePanelId: null,
        activePanelVersionId: null,
        appliedRevision: "online:legacy-v1",
      },
      activePanelName: null,
      availablePanels: [],
      legacyFallback: {
        status: "ready",
        publishedRevision: null,
      },
    });
    expect(appliedOnlyWithoutResolvedFallback.kind).toBe("none-sent");
    expect(appliedOnlyWithoutResolvedFallback.label).toBe("Nenhuma publicação enviada");
    expect(appliedOnlyWithoutResolvedFallback.appliedRevision).toBe("online:legacy-v1");
    expect(appliedOnlyWithoutResolvedFallback.sentRevision).toBeNull();
    expect(appliedOnlyWithoutResolvedFallback.otherPanelConfirmed).toBeNull();

    const omittedFallbackWithApplied = derivePublicationState({
      editingPanelId: "panel-a",
      editingPanelName: "Painel A",
      dirty: false,
      selectedDevice: {
        ...baseDevice,
        activePanelId: null,
        activePanelVersionId: null,
        appliedRevision: "online:legacy-v1",
      },
      activePanelName: null,
      availablePanels: [],
    });
    expect(omittedFallbackWithApplied.kind).toBe("none-sent");
    expect(omittedFallbackWithApplied.appliedRevision).toBe("online:legacy-v1");

    const draftLinkedWithoutVersion = derivePublicationState({
      editingPanelId: "panel-a",
      editingPanelName: "Painel A",
      dirty: false,
      selectedDevice: {
        ...baseDevice,
        activePanelId: "panel-b",
        activePanelVersionId: null,
        appliedRevision: "online:old",
      },
      activePanelName: "Painel B",
      availablePanels: [],
      legacyFallback: {
        status: "ready",
        publishedRevision: "online:legacy-v1",
      },
    });
    expect(draftLinkedWithoutVersion.kind).toBe("none-sent");
    expect(draftLinkedWithoutVersion.label).toBe("Nenhuma publicação enviada");

    const checkingLegacy = derivePublicationState({
      editingPanelId: "panel-a",
      editingPanelName: "Painel A",
      dirty: false,
      selectedDevice: {
        ...baseDevice,
        appliedRevision: "online:legacy-v1",
      },
      activePanelName: null,
      availablePanels: [],
      legacyFallback: {
        status: "loading",
        publishedRevision: null,
      },
    });
    expect(checkingLegacy.kind).toBe("checking-legacy");
    expect(checkingLegacy.label).toBe("Verificando publicação do dispositivo…");
    expect(checkingLegacy.otherPanelConfirmed).toBeNull();

    const errorLegacy = derivePublicationState({
      editingPanelId: "panel-a",
      editingPanelName: "Painel A",
      dirty: false,
      selectedDevice: {
        ...baseDevice,
        appliedRevision: "online:legacy-v1",
      },
      activePanelName: null,
      availablePanels: [],
      legacyFallback: {
        status: "error",
        publishedRevision: null,
      },
    });
    expect(errorLegacy.kind).toBe("legacy-error");
    expect(errorLegacy.label).toBe("Erro ao verificar publicação do dispositivo");
    expect(errorLegacy.otherPanelConfirmed).toBeNull();

    const legacyDeviceStatus = deriveDeviceActiveStatus({
      device: {
        ...baseDevice,
        activePanelId: null,
        activePanelVersionId: null,
        appliedRevision: "online:legacy-v1",
      },
      activePanelName: null,
      legacyFallback: {
        status: "ready",
        publishedRevision: "online:legacy-v1",
      },
    });
    expect(legacyDeviceStatus.kind).toBe("legacy-active");
    expect(legacyDeviceStatus.label).toBe("Publicação legada confirmada pelo dispositivo");
  });
});
