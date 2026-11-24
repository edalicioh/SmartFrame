import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as database from "@smartframe/database";
import { issuePairingCode, redeemPairingCode } from "@smartframe/frames";
import {
  buildEditorShortcutHref,
  deriveOverviewGuidance,
  formatListCountLabel,
  isEligiblePanelKey,
  mapOverviewDeviceCard,
  mapOverviewPanelCard,
  normalizeEditorSearchParam,
  OVERVIEW_DEVICES_LIMIT,
  OVERVIEW_PANELS_LIMIT,
  OVERVIEW_PHOTOS_LIMIT,
  resolveInitialEditorSelection,
  shouldRetryDeviceListRefresh,
} from "../apps/web/src/lib/online-editor/overview";

vi.mock("server-only", () => ({}));
import { getOverviewData } from "../apps/web/src/lib/overview-data";
import { publishOnlinePanel } from "../apps/web/src/lib/publish-online-panel";

describe("online editor overview pure helpers", () => {
  it("reconhece apenas chaves elegíveis de painéis online", () => {
    expect(isEligiblePanelKey("panel:abc")).toBe(true);
    expect(isEligiblePanelKey("online:dev-1")).toBe(true);
    expect(isEligiblePanelKey("photo:household-1")).toBe(false);
    expect(isEligiblePanelKey("legacy:1")).toBe(false);
    expect(isEligiblePanelKey(null)).toBe(false);
    expect(isEligiblePanelKey(undefined)).toBe(false);
    expect(isEligiblePanelKey("")).toBe(false);
  });

  it("normaliza parâmetros de busca e monta atalhos contextuais seguros", () => {
    expect(normalizeEditorSearchParam("  panel-1  ")).toBe("panel-1");
    expect(normalizeEditorSearchParam(["dev-2", "dev-3"])).toBe("dev-2");
    expect(normalizeEditorSearchParam("   ")).toBeNull();
    expect(normalizeEditorSearchParam(undefined)).toBeNull();

    expect(buildEditorShortcutHref({})).toBe("/layouts");
    expect(buildEditorShortcutHref({ panelId: "p1" })).toBe("/layouts?panelId=p1");
    expect(buildEditorShortcutHref({ deviceId: "d1" })).toBe("/layouts?deviceId=d1");
    expect(buildEditorShortcutHref({ panelId: "p 1", deviceId: "d&2" })).toBe(
      "/layouts?panelId=p+1&deviceId=d%262",
    );
  });

  it("valida seleção inicial contra listas autenticadas sem vazar existência externa", () => {
    const panels = [{ id: "p1" }, { id: "p2" }];
    const devices = [{ id: "d1" }];

    expect(
      resolveInitialEditorSelection({
        initialPanelId: "p2",
        initialDeviceId: "d1",
        panels,
        devices,
      }),
    ).toEqual({
      panelId: "p2",
      deviceId: "d1",
      fallbackNotice: null,
    });

    const foreignAttempt = resolveInitialEditorSelection({
      initialPanelId: "foreign-panel-id",
      initialDeviceId: "foreign-device-id",
      panels,
      devices,
    });
    expect(foreignAttempt.panelId).toBeNull();
    expect(foreignAttempt.deviceId).toBeNull();
    expect(foreignAttempt.fallbackNotice).toContain("painel solicitado");
    expect(foreignAttempt.fallbackNotice).toContain("dispositivo solicitado");
    expect(foreignAttempt.fallbackNotice).not.toContain("foreign");

    const partialValid = resolveInitialEditorSelection({
      initialPanelId: "p1",
      initialDeviceId: "revoked-or-missing",
      panels,
      devices,
    });
    expect(partialValid.panelId).toBe("p1");
    expect(partialValid.deviceId).toBeNull();
    expect(partialValid.fallbackNotice).toContain("dispositivo solicitado");
  });

  it("formata totais distinguindo exibidos do total quando há limite", () => {
    expect(formatListCountLabel(0, 0, "dispositivo", "dispositivos")).toBe("0 dispositivos");
    expect(formatListCountLabel(1, 1, "dispositivo", "dispositivos")).toBe("1 dispositivo");
    expect(formatListCountLabel(3, 3, "painel", "painéis")).toBe("3 painéis");
    expect(formatListCountLabel(12, 18, "dispositivo", "dispositivos")).toBe(
      "Exibindo 12 de 18 dispositivos",
    );
  });

  it("mapeia estados de dispositivo e ausência de painel seguindo critérios da fase 03", () => {
    const devConfirmed = {
      id: "dev-1111-aaaa",
      name: "Tablet Sala",
      lastSeenAt: "2026-11-23T10:00:00.000Z",
      appliedRevision: "online:ver-1",
      activePanelId: "panel-1",
      activePanelVersionId: "ver-1",
    };
    const devPending = {
      id: "dev-2222-bbbb",
      name: "Tablet Sala",
      lastSeenAt: null,
      appliedRevision: null,
      activePanelId: "panel-1",
      activePanelVersionId: "ver-2",
    };
    const devNone = {
      id: "dev-3333-cccc",
      name: "Tablet Quarto",
      lastSeenAt: null,
      appliedRevision: null,
      activePanelId: null,
      activePanelVersionId: null,
    };
    const devLegacy = {
      id: "dev-4444-dddd",
      name: "Tablet Cozinha",
      lastSeenAt: "2026-11-23T09:00:00.000Z",
      appliedRevision: "online:leg-v1",
      activePanelId: null,
      activePanelVersionId: null,
    };
    const allDevices = [devConfirmed, devPending, devNone, devLegacy];
    const allPanels = [{ id: "panel-1", name: "Painel Manhã" }];

    const confirmedCard = mapOverviewDeviceCard({
      device: devConfirmed,
      allDevices,
      activePanel: { id: "panel-1", name: "Painel Manhã" },
      allPanels,
      legacyPanel: null,
      totalPanels: 1,
    });
    expect(confirmedCard.displayName).toBe("Tablet Sala (dev-1111)");
    expect(confirmedCard.statusKind).toBe("confirmed");
    expect(confirmedCard.statusLabel).toBe("Versão enviada confirmada");
    expect(confirmedCard.activePanelName).toBe("Painel Manhã");
    expect(confirmedCard.lastCommunicationLabel).toContain("Última comunicação:");
    expect(confirmedCard.editorHref).toBe("/layouts?panelId=panel-1&deviceId=dev-1111-aaaa");

    const pendingCard = mapOverviewDeviceCard({
      device: devPending,
      allDevices,
      activePanel: { id: "panel-1", name: "Painel Manhã" },
      allPanels,
      legacyPanel: null,
      totalPanels: 1,
    });
    expect(pendingCard.statusKind).toBe("pending");
    expect(pendingCard.statusLabel).toBe("Aguardando confirmação");
    expect(pendingCard.lastCommunicationLabel).toBe("Sem registro de comunicação");

    const noneCard = mapOverviewDeviceCard({
      device: devNone,
      allDevices,
      activePanel: null,
      allPanels,
      legacyPanel: null,
      totalPanels: 1,
    });
    expect(noneCard.statusKind).toBe("none-sent");
    expect(noneCard.statusLabel).toBe("Nenhuma publicação enviada");
    expect(noneCard.activePanelName).toBeNull();
    expect(noneCard.editorHref).toBe("/layouts?deviceId=dev-3333-cccc");

    const legacyCard = mapOverviewDeviceCard({
      device: devLegacy,
      allDevices,
      activePanel: null,
      allPanels,
      legacyPanel: {
        id: "legacy-layout-id",
        name: "Painel Cozinha Legado",
        publishedVersionId: "leg-v1",
      },
      totalPanels: 2,
    });
    expect(legacyCard.statusKind).toBe("legacy-active");
    expect(legacyCard.statusLabel).toBe("Publicação legada confirmada pelo dispositivo");
    expect(legacyCard.activePanelName).toBe("Painel Cozinha Legado");
    expect(legacyCard.isLegacyFallback).toBe(true);
    expect(legacyCard.editorHref).toBe("/layouts?panelId=legacy-layout-id&deviceId=dev-4444-dddd");

    const pendingLegacyCard = mapOverviewDeviceCard({
      device: { ...devLegacy, appliedRevision: null },
      allDevices,
      activePanel: null,
      allPanels,
      legacyPanel: {
        id: "legacy-layout-id",
        name: "Painel Cozinha Legado",
        publishedVersionId: "leg-v1",
      },
      totalPanels: 2,
    });
    expect(pendingLegacyCard.statusKind).toBe("legacy-active");
    expect(pendingLegacyCard.activePanelName).toBe("Painel Cozinha Legado");
    expect(pendingLegacyCard.statusLabel).toBe(
      "Publicação legada ativa (aguardando confirmação da versão)",
    );
  });

  it("mapeia cartões de painel e orientações condicionais", () => {
    const panels = [
      { id: "p1", name: "Principal" },
      { id: "p2", name: "Secundário" },
      { id: "p3", name: "Publicado" },
    ];
    expect(
      mapOverviewPanelCard({
        panel: {
          id: "p1",
          name: "Principal",
          draftRevision: 3,
          hasPublishedVersion: true,
          activeDeviceCount: 2,
        },
        allPanels: panels,
      }),
    ).toMatchObject({
      displayName: "Principal",
      draftRevision: 3,
      badgeLabel: "2 ativo",
      badgeTone: "confirmed",
      statusLabel: "Enviado para 2 dispositivos",
      editorHref: "/layouts?panelId=p1",
    });

    expect(
      mapOverviewPanelCard({
        panel: {
          id: "p2",
          name: "Secundário",
          draftRevision: 1,
          hasPublishedVersion: false,
          activeDeviceCount: 0,
        },
        allPanels: panels,
      }),
    ).toMatchObject({
      badgeLabel: "Rascunho",
      badgeTone: "none",
      statusLabel: "Somente rascunho",
    });

    expect(
      mapOverviewPanelCard({
        panel: {
          id: "p3",
          name: "Publicado",
          draftRevision: 4,
          hasPublishedVersion: true,
          activeDeviceCount: 0,
        },
        allPanels: panels,
      }),
    ).toMatchObject({
      badgeLabel: "Publicado",
      badgeTone: "pending",
      statusLabel: "Com versão publicada (sem envio ativo)",
    });

    expect(
      mapOverviewPanelCard({
        panel: {
          id: "p3",
          name: "Publicado",
          draftRevision: 4,
          hasPublishedVersion: false,
          activeDeviceCount: 0,
          availableDeviceCount: 1,
        },
        allPanels: panels,
      }),
    ).toMatchObject({
      badgeLabel: "Disponibilizado",
      badgeTone: "pending",
      statusLabel: "Versão disponibilizada em 1 dispositivo (sem envio ativo)",
    });

    expect(
      mapOverviewPanelCard({
        panel: {
          id: "p3",
          name: "Publicado",
          draftRevision: 4,
          hasPublishedVersion: true,
          activeDeviceCount: 1,
          availableDeviceCount: 1,
          extraAvailableDeviceCount: 1,
        },
        allPanels: panels,
      }),
    ).toMatchObject({
      badgeLabel: "1 ativo",
      badgeTone: "confirmed",
      statusLabel: "Enviado para 1 dispositivo · disponibilizado em mais 1 dispositivo",
    });

    expect(
      shouldRetryDeviceListRefresh({
        requestedIncludeId: "dev-1",
        currentTargetId: "dev-101",
        receivedDeviceIds: ["dev-1", "dev-2"],
        retries: 0,
      }),
    ).toBe(true);

    expect(
      shouldRetryDeviceListRefresh({
        requestedIncludeId: "dev-1",
        currentTargetId: "dev-101",
        receivedDeviceIds: ["dev-101"],
        retries: 0,
      }),
    ).toBe(false);

    expect(
      shouldRetryDeviceListRefresh({
        requestedIncludeId: "dev-1",
        currentTargetId: "dev-101",
        receivedDeviceIds: ["dev-1"],
        retries: 2,
      }),
    ).toBe(false);

    const empty = deriveOverviewGuidance({
      totalPanels: 0,
      totalDevices: 0,
      totalPhotos: 0,
      readyPhotos: 0,
      pendingPhotos: 0,
      devicesWithoutPanel: 0,
      devicesPendingConfirmation: 0,
    });
    expect(empty.mode).toBe("empty");
    expect(empty.steps.map((s) => s.key)).toEqual(["create-panel", "add-photos", "pair-device"]);
    expect(empty.steps.find((s) => s.key === "add-photos")?.optional).toBe(true);

    const panelsOnly = deriveOverviewGuidance({
      totalPanels: 2,
      totalDevices: 0,
      totalPhotos: 0,
      readyPhotos: 0,
      pendingPhotos: 0,
      devicesWithoutPanel: 0,
      devicesPendingConfirmation: 0,
      firstPanelId: "p1",
    });
    expect(panelsOnly.mode).toBe("partial");
    expect(panelsOnly.steps.map((s) => s.key)).toEqual(["add-photos", "pair-device"]);

    const devicesOnly = deriveOverviewGuidance({
      totalPanels: 0,
      totalDevices: 1,
      totalPhotos: 2,
      readyPhotos: 2,
      pendingPhotos: 0,
      devicesWithoutPanel: 1,
      devicesPendingConfirmation: 0,
    });
    expect(devicesOnly.mode).toBe("partial");
    expect(devicesOnly.steps.map((s) => s.key)).toEqual(["create-panel"]);

    const activeMissingPanel = deriveOverviewGuidance({
      totalPanels: 1,
      totalDevices: 2,
      totalPhotos: 1,
      readyPhotos: 1,
      pendingPhotos: 0,
      devicesWithoutPanel: 1,
      devicesPendingConfirmation: 0,
      firstPanelId: "p1",
      firstDeviceWithoutPanelId: "d2",
    });
    expect(activeMissingPanel.mode).toBe("active");
    expect(activeMissingPanel.steps[0]?.key).toBe("assign-panel");
    expect(activeMissingPanel.steps[0]?.href).toBe("/layouts?panelId=p1&deviceId=d2");

    const activePending = deriveOverviewGuidance({
      totalPanels: 1,
      totalDevices: 1,
      totalPhotos: 1,
      readyPhotos: 1,
      pendingPhotos: 0,
      devicesWithoutPanel: 0,
      devicesPendingConfirmation: 1,
    });
    expect(activePending.steps[0]?.key).toBe("pending-confirmation");

    const activeProcessing = deriveOverviewGuidance({
      totalPanels: 1,
      totalDevices: 1,
      totalPhotos: 2,
      readyPhotos: 0,
      pendingPhotos: 2,
      devicesWithoutPanel: 0,
      devicesPendingConfirmation: 0,
    });
    expect(activeProcessing.steps[0]?.key).toBe("processing-photos");

    const active = deriveOverviewGuidance({
      totalPanels: 2,
      totalDevices: 1,
      totalPhotos: 3,
      readyPhotos: 3,
      pendingPhotos: 0,
      devicesWithoutPanel: 0,
      devicesPendingConfirmation: 0,
    });
    expect(active.mode).toBe("active");
    expect(active.steps).toEqual([]);
  });
});

describe("getOverviewData queries e isolamento", () => {
  const db = database.getDatabase();
  const ownerId = randomUUID();
  const foreignId = randomUUID();
  let householdId = "";
  let foreignHouseholdId = "";

  beforeAll(async () => {
    const owner = await db.user.create({
      data: {
        id: ownerId,
        name: "Admin Visão Geral",
        email: `${ownerId}@test.local`,
        household: { create: { name: "Casa Visão" } },
      },
      include: { household: true },
    });
    householdId = owner.household!.id;

    const foreign = await db.user.create({
      data: {
        id: foreignId,
        name: "Admin Externo",
        email: `${foreignId}@test.local`,
        household: { create: { name: "Casa Externa" } },
      },
      include: { household: true },
    });
    foreignHouseholdId = foreign.household!.id;
  });

  afterAll(async () => {
    await db.household.deleteMany({ where: { ownerId: { in: [ownerId, foreignId] } } });
    await db.user.deleteMany({ where: { id: { in: [ownerId, foreignId] } } });
    await db.$disconnect();
  });

  it("retorna estado vazio real antes de criar dados na família", async () => {
    const empty = await getOverviewData(db, householdId);
    expect(empty.totals).toEqual({
      devices: 0,
      panels: 0,
      photos: 0,
      readyPhotos: 0,
      pendingPhotos: 0,
      failedPhotos: 0,
      confirmedDevices: 0,
      devicesWithoutPanel: 0,
      devicesPendingConfirmation: 0,
    });
    expect(empty.devices).toEqual([]);
    expect(empty.panels).toEqual([]);
    expect(empty.recentPhotos).toEqual([]);
    expect(empty.guidance.mode).toBe("empty");
  });

  it("isola famílias, exclui revogados/legados photo:, conta fotos por status e aplica limites", async () => {
    // Dados da outra família não podem vazar para householdId
    const foreignPairing = await issuePairingCode(db, foreignHouseholdId, foreignId);
    await redeemPairingCode(db, foreignPairing.code, "Tablet Externo");
    await db.layout.create({
      data: {
        householdId: foreignHouseholdId,
        key: `panel:${randomUUID()}`,
        name: "Painel Externo",
        draftRevision: 2,
      },
    });
    await db.media.create({
      data: { householdId: foreignHouseholdId, filename: "externa.webp", status: "ready" },
    });

    // Layout legado não-online (photo:) e layout sem chave não entram como painéis editáveis
    await db.layout.create({
      data: {
        householdId,
        key: `photo:${householdId}`,
        name: "Legado Foto",
        draftRevision: 1,
      },
    });
    await db.layout.create({
      data: {
        householdId,
        key: null,
        name: "Sem chave",
        draftRevision: 1,
      },
    });

    // Dispositivo revogado não entra
    const revokedPairing = await issuePairingCode(db, householdId, ownerId);
    const revoked = await redeemPairingCode(db, revokedPairing.code, "Tablet Revogado");
    await db.device.update({
      where: { id: revoked.deviceId },
      data: { revokedAt: new Date(), tokenHash: null },
    });

    // Cria 14 painéis elegíveis (acima do limite OVERVIEW_PANELS_LIMIT = 12)
    const createdPanelIds: string[] = [];
    for (let i = 1; i <= OVERVIEW_PANELS_LIMIT + 2; i++) {
      const panel = await db.layout.create({
        data: {
          householdId,
          key: `panel:${randomUUID()}`,
          name: `Painel ${i}`,
          draftRevision: i,
        },
      });
      createdPanelIds.push(panel.id);
    }
    const activePanelId = createdPanelIds[0];
    const activeVersion = await db.layoutVersion.create({
      data: { layoutId: activePanelId, config: { refreshSeconds: 20 } },
    });

    // Cria dispositivo com legado online:<id> ativo por fallback (activePanelId = null)
    const legacyPairing = await issuePairingCode(db, householdId, ownerId);
    const legacyDevice = await redeemPairingCode(db, legacyPairing.code, "Tablet Legado");
    const legacyLayout = await db.layout.create({
      data: {
        householdId,
        key: `online:${legacyDevice.deviceId}`,
        name: "Painel Legado",
        draftRevision: 1,
      },
    });
    const legacyVer = await db.layoutVersion.create({
      data: { layoutId: legacyLayout.id, config: { refreshSeconds: 15 } },
    });
    await db.layout.update({
      where: { id: legacyLayout.id },
      data: { publishedVersionId: legacyVer.id },
    });
    await db.device.update({
      where: { id: legacyDevice.deviceId },
      data: { appliedRevision: `online:${legacyVer.id}` },
    });

    // Cria 13 dispositivos adicionais (total 14 não revogados, acima do limite 12)
    for (let i = 1; i <= OVERVIEW_DEVICES_LIMIT + 1; i++) {
      const pairing = await issuePairingCode(db, householdId, ownerId);
      const dev = await redeemPairingCode(db, pairing.code, `Tablet ${i}`);
      if (i === OVERVIEW_DEVICES_LIMIT + 1) {
        await db.device.update({
          where: { id: dev.deviceId },
          data: {
            activePanelId,
            activePanelVersionId: activeVersion.id,
            appliedRevision: `online:${activeVersion.id}`,
            lastSeenAt: new Date("2026-11-23T11:00:00.000Z"),
          },
        });
      }
    }

    // Fotos com diferentes status
    await db.media.createMany({
      data: [
        { householdId, filename: "f1.webp", status: "ready" },
        { householdId, filename: "f2.webp", status: "ready" },
        { householdId, filename: "f3.webp", status: "pending" },
        { householdId, filename: "f4.webp", status: "processing" },
        { householdId, filename: "f5.webp", status: "error" },
        { householdId, filename: "f6.webp", status: "ready" },
        { householdId, filename: "f7.webp", status: "ready" },
      ],
    });

    const data = await getOverviewData(db, householdId);

    // Totais refletem apenas householdId e critérios válidos
    expect(data.totals).toEqual({
      devices: OVERVIEW_DEVICES_LIMIT + 2,
      panels: OVERVIEW_PANELS_LIMIT + 3, // 14 panel: + 1 online:
      photos: 7,
      readyPhotos: 4,
      pendingPhotos: 2,
      failedPhotos: 1,
      confirmedDevices: 2,
      devicesWithoutPanel: 12,
      devicesPendingConfirmation: 0,
    });

    // Listas respeitam limites explícitos
    expect(data.devices).toHaveLength(OVERVIEW_DEVICES_LIMIT);
    expect(data.panels).toHaveLength(OVERVIEW_PANELS_LIMIT);
    expect(data.recentPhotos).toHaveLength(OVERVIEW_PHOTOS_LIMIT);

    // Nenhum item externo, revogado ou photo: aparece
    expect(data.devices.some((d) => d.displayName.includes("Externo"))).toBe(false);
    expect(data.devices.some((d) => d.displayName.includes("Revogado"))).toBe(false);
    expect(data.panels.some((p) => p.displayName.includes("Externo"))).toBe(false);
    expect(data.panels.some((p) => p.displayName.includes("Legado Foto"))).toBe(false);
    expect(data.panels.some((p) => p.displayName.includes("Sem chave"))).toBe(false);

    // Dispositivo confirmado mais recente aparece com painel enviado e atalho contextual
    const confirmed = data.devices.find((d) => d.statusKind === "confirmed");
    expect(confirmed).toBeDefined();
    expect(confirmed?.activePanelName).toBe("Painel 1");
    expect(confirmed?.editorHref).toContain(`panelId=${activePanelId}`);
    expect(confirmed?.editorHref).toContain(`deviceId=${confirmed?.id}`);
  });

  it("conta fallback legado ativo em painéis e rejeita versão incompatível com o painel ativo", async () => {
    const legacyPairing = await issuePairingCode(db, householdId, ownerId);
    const legacyDevice = await redeemPairingCode(db, legacyPairing.code, "Tablet Legado Contado");
    const legacyLayout = await db.layout.create({
      data: {
        householdId,
        key: `online:${legacyDevice.deviceId}`,
        name: "Painel Legado Contado",
        draftRevision: 1,
      },
    });
    const legacyVersion = await db.layoutVersion.create({
      data: { layoutId: legacyLayout.id, config: { refreshSeconds: 20 } },
    });
    await db.layout.update({
      where: { id: legacyLayout.id },
      data: { publishedVersionId: legacyVersion.id },
    });
    await db.device.update({
      where: { id: legacyDevice.deviceId },
      data: { appliedRevision: `online:${legacyVersion.id}` },
    });

    const localPanel = await db.layout.create({
      data: {
        householdId,
        key: `panel:${randomUUID()}`,
        name: "Painel Local Sem Versão Compatível",
        draftRevision: 1,
      },
    });
    const foreignPanel = await db.layout.create({
      data: {
        householdId: foreignHouseholdId,
        key: `panel:${randomUUID()}`,
        name: "Painel Estrangeiro",
        draftRevision: 1,
      },
    });
    const foreignVersion = await db.layoutVersion.create({
      data: { layoutId: foreignPanel.id, config: { refreshSeconds: 30 } },
    });
    const mismatchPairing = await issuePairingCode(db, householdId, ownerId);
    const mismatchDevice = await redeemPairingCode(db, mismatchPairing.code, "Tablet Versão Errada");
    await db.device.update({
      where: { id: mismatchDevice.deviceId },
      data: {
        activePanelId: localPanel.id,
        activePanelVersionId: foreignVersion.id,
        appliedRevision: `online:${foreignVersion.id}`,
      },
    });

    const data = await getOverviewData(db, householdId);

    const legacyPanelCard = data.panels.find((p) => p.id === legacyLayout.id);
    expect(legacyPanelCard).toMatchObject({
      activeDeviceCount: 1,
      statusLabel: "Enviado para 1 dispositivo",
    });
    const legacyDeviceCard = data.devices.find((d) => d.id === legacyDevice.deviceId);
    expect(legacyDeviceCard).toMatchObject({
      statusKind: "legacy-active",
      activePanelName: "Painel Legado Contado",
    });

    const mismatchCard = data.devices.find((d) => d.id === mismatchDevice.deviceId);
    expect(mismatchCard).toMatchObject({
      statusKind: "none-sent",
      activePanelName: null,
    });
    const localPanelCard = data.panels.find((p) => p.id === localPanel.id);
    expect(localPanelCard).toMatchObject({
      activeDeviceCount: 0,
      statusLabel: "Somente rascunho",
    });
  });

  it("rejeita publishedVersionId legado incompatível e mantém orientação fora do limite de 12 cartões", async () => {
    const isolatedOwnerId = randomUUID();
    const isolatedUser = await db.user.create({
      data: {
        id: isolatedOwnerId,
        name: "Admin Limite",
        email: `${isolatedOwnerId}@test.local`,
        household: { create: { name: "Casa Limite" } },
      },
      include: { household: true },
    });
    const isolatedHouseholdId = isolatedUser.household!.id;

    try {
      const sharedPanel = await db.layout.create({
        data: {
          householdId: isolatedHouseholdId,
          key: `panel:${randomUUID()}`,
          name: "Painel Compartilhado",
          draftRevision: 1,
        },
      });
      const sharedVersion = await db.layoutVersion.create({
        data: { layoutId: sharedPanel.id, config: { refreshSeconds: 15 } },
      });

      // 1 dispositivo antigo sem painel (ficará fora dos 12 mais recentes)
      const olderUnassigned = await db.device.create({
        data: {
          householdId: isolatedHouseholdId,
          name: "Tablet Antigo Sem Painel",
          createdAt: new Date("2026-01-01T10:00:00.000Z"),
        },
      });

      // 1 dispositivo legado cuja publishedVersionId aponta para outro layout (deve ser rejeitada)
      const badLegacyDevice = await db.device.create({
        data: {
          householdId: isolatedHouseholdId,
          name: "Tablet Legado Versão Inválida",
          createdAt: new Date("2026-01-02T10:00:00.000Z"),
          appliedRevision: `online:${sharedVersion.id}`,
        },
      });
      const badLegacyLayout = await db.layout.create({
        data: {
          householdId: isolatedHouseholdId,
          key: `online:${badLegacyDevice.id}`,
          name: "Legado Inconsistente",
          publishedVersionId: sharedVersion.id,
        },
      });

      // 12 dispositivos recentes confirmados (preenchem OVERVIEW_DEVICES_LIMIT = 12)
      for (let i = 0; i < OVERVIEW_DEVICES_LIMIT; i++) {
        await db.device.create({
          data: {
            householdId: isolatedHouseholdId,
            name: `Tablet Confirmado ${i + 1}`,
            createdAt: new Date(Date.UTC(2026, 1, 1, 10, i, 0)),
            activePanelId: sharedPanel.id,
            activePanelVersionId: sharedVersion.id,
            appliedRevision: `online:${sharedVersion.id}`,
          },
        });
      }

      const data = await getOverviewData(db, isolatedHouseholdId);
      expect(data.totals.devices).toBe(OVERVIEW_DEVICES_LIMIT + 2);
      expect(data.devices).toHaveLength(OVERVIEW_DEVICES_LIMIT);
      expect(data.totals.confirmedDevices).toBe(OVERVIEW_DEVICES_LIMIT);
      expect(data.totals.devicesWithoutPanel).toBe(2);

      // A orientação identifica os dispositivos sem painel mesmo estando fora da lista de 12 cartões
      const assignStep = data.guidance.steps.find((step) => step.key === "assign-panel");
      expect(assignStep).toBeDefined();
      expect(assignStep?.title).toContain("2 dispositivos ainda sem painel enviado");
      expect(
        assignStep?.href.includes(`panelId=${sharedPanel.id}`) ||
          assignStep?.href.includes(`panelId=${badLegacyLayout.id}`),
      ).toBe(true);
      expect(
        assignStep?.href.includes(badLegacyDevice.id) ||
          assignStep?.href.includes(olderUnassigned.id),
      ).toBe(true);

      // O painel legado inconsistente não contabiliza dispositivo ativo nem reivindica publicação alheia
      const badLegacyPanelCard = data.panels.find((p) => p.id === badLegacyLayout.id);
      expect(badLegacyPanelCard).toMatchObject({
        activeDeviceCount: 0,
        hasPublishedVersion: false,
        statusLabel: "Somente rascunho",
      });
    } finally {
      await db.household.deleteMany({ where: { ownerId: isolatedOwnerId } });
      await db.user.deleteMany({ where: { id: isolatedOwnerId } });
    }
  });

  it("mantém totais, cartões e orientação consistentes diante de publicação concorrente durante a leitura", async () => {
    const concOwnerId = randomUUID();
    const concUser = await db.user.create({
      data: {
        id: concOwnerId,
        name: "Admin Concorrência",
        email: `${concOwnerId}@test.local`,
        household: { create: { name: "Casa Concorrência" } },
      },
      include: { household: true },
    });
    const concHouseholdId = concUser.household!.id;
    const writerDb = database.createDatabase(
      process.env.DATABASE_URL ?? "file:./.data/smartframe.db",
    );

    try {
      const panelA = await db.layout.create({
        data: {
          householdId: concHouseholdId,
          key: `panel:${randomUUID()}`,
          name: "Painel A",
          draftRevision: 1,
        },
      });
      const verA = await db.layoutVersion.create({
        data: { layoutId: panelA.id, config: { refreshSeconds: 15 } },
      });
      await db.layout.update({
        where: { id: panelA.id },
        data: { publishedVersionId: verA.id },
      });
      await db.device.create({
        data: {
          householdId: concHouseholdId,
          name: "Tablet Concorrente",
          activePanelId: panelA.id,
          activePanelVersionId: verA.id,
          appliedRevision: `online:${verA.id}`,
        },
      });

      const makeExtendedReader = () => {
        let layoutFindCount = 0;
        return db.$extends({
          query: {
            layout: {
              async findMany({ args, query }) {
                const rows = await query(args);
                layoutFindCount += 1;
                // Entre panelRows (1ª leitura de layout.findMany) e relatedPanels (2ª leitura),
                // outra conexão altera um dado que será lido posteriormente na sequência.
                if (layoutFindCount === 1) {
                  await writerDb.layout.update({
                    where: { id: panelA.id },
                    data: { name: "Painel A Alterado Concorrentemente" },
                  });
                }
                return rows;
              },
            },
          },
        });
      };

      // 1. Sem $transaction, a 1ª leitura vê "Painel A" e a 2ª leitura vê "Painel A Alterado Concorrentemente".
      const nonTxReader = makeExtendedReader();
      const nonTxDelegate = {
        media: nonTxReader.media,
        device: nonTxReader.device,
        layout: nonTxReader.layout,
        layoutVersion: nonTxReader.layoutVersion,
        devicePanelAccess: nonTxReader.devicePanelAccess,
      } as unknown as typeof db;
      const inconsistent = await getOverviewData(nonTxDelegate, concHouseholdId);
      expect(inconsistent.panels[0]?.displayName).toBe("Painel A");
      expect(inconsistent.devices[0]?.activePanelName).toBe("Painel A Alterado Concorrentemente");

      // 2. Com $transaction, toda a sequência compartilha o mesmo snapshot consistente.
      await writerDb.layout.update({ where: { id: panelA.id }, data: { name: "Painel A" } });
      const snapshot = await getOverviewData(
        makeExtendedReader() as unknown as typeof db,
        concHouseholdId,
      );
      expect(snapshot.totals.confirmedDevices).toBe(1);
      expect(snapshot.totals.devicesWithoutPanel).toBe(0);
      expect(snapshot.panels[0]?.displayName).toBe("Painel A");
      expect(snapshot.devices[0]).toMatchObject({
        statusKind: "confirmed",
        activePanelName: "Painel A",
      });
      const panelACard = snapshot.panels.find((p) => p.id === panelA.id);
      expect(panelACard?.activeDeviceCount).toBe(1);
    } finally {
      await writerDb.$disconnect();
      await db.household.deleteMany({ where: { ownerId: concOwnerId } });
      await db.user.deleteMany({ where: { id: concOwnerId } });
    }
  });

  it("distingue painel legado disponibilizado com activate: false, transição para Publicado e disponibilidade adicional", async () => {
    const legacyOwnerId = randomUUID();
    try {
      const user = await db.user.create({
        data: {
          id: legacyOwnerId,
          name: "Legado Disponível",
          email: `${legacyOwnerId}@test.local`,
          household: { create: { name: "Casa Legado Disponível" } },
        },
        include: { household: true },
      });
      const legacyHouseholdId = user.household!.id;
      const originDevice = await db.device.create({
        data: {
          householdId: legacyHouseholdId,
          name: "Tablet Origem",
        },
      });
      const targetDevice = await db.device.create({
        data: {
          householdId: legacyHouseholdId,
          name: "Tablet Destino",
        },
      });
      const legacyPanel = await db.layout.create({
        data: {
          householdId: legacyHouseholdId,
          key: `online:${originDevice.id}`,
          name: "Painel Legado Compartilhado",
          draftRevision: 1,
        },
      });

      await publishOnlinePanel(db, {
        householdId: legacyHouseholdId,
        panelId: legacyPanel.id,
        deviceId: targetDevice.id,
        expectedRevision: 1,
        activate: false,
      });

      const availableSnapshot = await getOverviewData(db, legacyHouseholdId);
      expect(availableSnapshot.panels.find((p) => p.id === legacyPanel.id)).toMatchObject({
        displayName: "Painel Legado Compartilhado",
        activeDeviceCount: 0,
        availableDeviceCount: 1,
        hasPublishedVersion: true,
        badgeLabel: "Disponibilizado",
        badgeTone: "pending",
        statusLabel: "Versão disponibilizada em 1 dispositivo (sem envio ativo)",
      });

      // Ao remover a permissão do tablet destino, a versão publicada continua existindo -> Publicado (não Rascunho).
      await db.devicePanelAccess.delete({
        where: { deviceId_panelId: { deviceId: targetDevice.id, panelId: legacyPanel.id } },
      });
      const afterRevokeSnapshot = await getOverviewData(db, legacyHouseholdId);
      expect(afterRevokeSnapshot.panels.find((p) => p.id === legacyPanel.id)).toMatchObject({
        activeDeviceCount: 0,
        availableDeviceCount: 0,
        hasPublishedVersion: true,
        badgeLabel: "Publicado",
        badgeTone: "pending",
        statusLabel: "Com versão publicada (sem envio ativo)",
      });

      // Cenário misto: ativo por fallback no tablet origem E disponibilizado no tablet destino (ambos com contagem 1).
      const originVer = await db.layoutVersion.create({
        data: { layoutId: legacyPanel.id, config: { refreshSeconds: 20 } },
      });
      await db.layout.update({
        where: { id: legacyPanel.id },
        data: { publishedVersionId: originVer.id },
      });
      await publishOnlinePanel(db, {
        householdId: legacyHouseholdId,
        panelId: legacyPanel.id,
        deviceId: targetDevice.id,
        expectedRevision: 1,
        activate: false,
      });
      const mixedSnapshot = await getOverviewData(db, legacyHouseholdId);
      expect(mixedSnapshot.panels.find((p) => p.id === legacyPanel.id)).toMatchObject({
        activeDeviceCount: 1,
        availableDeviceCount: 1,
        badgeLabel: "1 ativo",
        badgeTone: "confirmed",
        statusLabel: "Enviado para 1 dispositivo · disponibilizado em mais 1 dispositivo",
      });
    } finally {
      await db.household.deleteMany({ where: { ownerId: legacyOwnerId } });
      await db.user.deleteMany({ where: { id: legacyOwnerId } });
    }
  });

  it("suporta mais de 1000 dispositivos sem exceder limite de parâmetros IN do SQLite", async () => {
    const bulkOwnerId = randomUUID();
    try {
      const user = await db.user.create({
        data: {
          id: bulkOwnerId,
          name: "Bulk Devices",
          email: `${bulkOwnerId}@test.local`,
          household: { create: { name: "Casa Grande" } },
        },
        include: { household: true },
      });
      const bulkHouseholdId = user.household!.id;
      await db.$executeRaw`
        WITH RECURSIVE seq(n) AS (
          SELECT 1
          UNION ALL
          SELECT n + 1 FROM seq WHERE n < 1050
        )
        INSERT INTO "Device" ("id", "householdId", "name")
        SELECT ${`${bulkOwnerId}-dev-`} || n, ${bulkHouseholdId}, 'Tablet ' || n
        FROM seq
      `;
      const snapshot = await getOverviewData(db, bulkHouseholdId);
      expect(snapshot.totals.devices).toBe(1050);
      expect(snapshot.totals.devicesWithoutPanel).toBe(1050);
      expect(snapshot.devices).toHaveLength(OVERVIEW_DEVICES_LIMIT);
      expect(snapshot.guidance.steps[0]?.key).toBe("create-panel");
    } finally {
      await db.household.deleteMany({ where: { ownerId: bulkOwnerId } });
      await db.user.deleteMany({ where: { id: bulkOwnerId } });
    }
  });
});
