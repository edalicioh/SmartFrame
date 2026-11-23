import { afterEach, describe, expect, it } from "vitest";
import {
  applyPanelTemplate,
  controlDeckAgentExecuteSchema,
  controlDeckBindingCreateSchema,
  controlDeckBindingTargetSchema,
  controlDeckBindingUpdateSchema,
  controlDeckExecuteRequestSchema,
  controlDeckExecuteResultSchema,
  controlDeckPlayerBindingSchema,
  controlDeckTileSchema,
  controlDeckWidgetSchema,
  createDefaultDashboardGridLayout,
  defaultOnlineDashboard,
  isControlDeckActionIdempotent,
  unavailableControlDeckHostStatus,
} from "@smartframe/contracts";
import { getControlDeckAgentConfig } from "@smartframe/frames";
import { isControlDeckHostAuthorizedForHousehold } from "../packages/frames/src/control-deck";

const ORIGINAL_URL = process.env.SMARTFRAME_CONTROL_DECK_URL;
const ORIGINAL_TOKEN = process.env.SMARTFRAME_CONTROL_DECK_TOKEN;

afterEach(() => {
  if (ORIGINAL_URL === undefined) delete process.env.SMARTFRAME_CONTROL_DECK_URL;
  else process.env.SMARTFRAME_CONTROL_DECK_URL = ORIGINAL_URL;
  if (ORIGINAL_TOKEN === undefined) delete process.env.SMARTFRAME_CONTROL_DECK_TOKEN;
  else process.env.SMARTFRAME_CONTROL_DECK_TOKEN = ORIGINAL_TOKEN;
});

describe("Contratos do Control Deck (Fase 6)", () => {
  it("associa o agente de host somente ao household explicitamente configurado", () => {
    const previous = process.env.SMARTFRAME_CONTROL_DECK_HOUSEHOLD_ID;
    process.env.SMARTFRAME_CONTROL_DECK_HOUSEHOLD_ID = "house-a";
    try {
      expect(isControlDeckHostAuthorizedForHousehold("house-a")).toBe(true);
      expect(isControlDeckHostAuthorizedForHousehold("house-b")).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.SMARTFRAME_CONTROL_DECK_HOUSEHOLD_ID;
      else process.env.SMARTFRAME_CONTROL_DECK_HOUSEHOLD_ID = previous;
    }
  });
  it("rejeita campos sensíveis em controlDeckTileSchema (.strict)", () => {
    const validTile = controlDeckTileSchema.parse({
      id: "tile-1",
      bindingId: "bind-1",
      label: "Abrir Terminal",
      icon: "terminal",
    });
    expect(validTile).toEqual({
      id: "tile-1",
      bindingId: "bind-1",
      label: "Abrir Terminal",
      icon: "terminal",
    });

    for (const sensitiveKey of ["command", "path", "args", "script", "cwd", "token"]) {
      expect(
        controlDeckTileSchema.safeParse({
          id: "tile-1",
          bindingId: "bind-1",
          label: "Atalho",
          icon: "bolt",
          [sensitiveKey]: "valor-sensivel",
        }).success,
      ).toBe(false);
    }
  });

  it("impõe limites de colunas, máximo de 16 tiles e unicidade de IDs no widget", () => {
    const tiles16 = Array.from({ length: 16 }, (_, i) => ({
      id: `t-${i + 1}`,
      bindingId: `b-${i + 1}`,
      label: `Botão ${i + 1}`,
      icon: "bolt" as const,
    }));
    const valid = controlDeckWidgetSchema.parse({
      enabled: true,
      title: "Mesa",
      columns: 4,
      tiles: tiles16,
    });
    expect(valid.tiles).toHaveLength(16);

    const tiles17 = [
      ...tiles16,
      { id: "t-17", bindingId: "b-17", label: "Extra", icon: "bolt" as const },
    ];
    expect(controlDeckWidgetSchema.safeParse({ tiles: tiles17 }).success).toBe(false);
    expect(controlDeckWidgetSchema.safeParse({ columns: 1 }).success).toBe(false);
    expect(controlDeckWidgetSchema.safeParse({ columns: 5 }).success).toBe(false);
    expect(
      controlDeckWidgetSchema.safeParse({
        tiles: [
          { id: "dup", bindingId: "b1", label: "A", icon: "bolt" },
          { id: "dup", bindingId: "b2", label: "B", icon: "bolt" },
        ],
      }).success,
    ).toBe(false);
  });

  it("classifica corretamente ações idempotentes e não idempotentes", () => {
    expect(isControlDeckActionIdempotent("volume", "set_mute")).toBe(true);
    expect(isControlDeckActionIdempotent("volume", "set_level")).toBe(true);
    expect(isControlDeckActionIdempotent("app_volume", "set_level")).toBe(true);
    expect(isControlDeckActionIdempotent("brightness", "set_level")).toBe(true);
    expect(isControlDeckActionIdempotent("mic_ptt", "set_mute")).toBe(true);
    expect(isControlDeckActionIdempotent("mic_ptt", "hold_unmute")).toBe(true);

    expect(isControlDeckActionIdempotent("shortcut", "launch")).toBe(false);
    expect(isControlDeckActionIdempotent("media", "play_pause")).toBe(false);
    expect(isControlDeckActionIdempotent("media", "next")).toBe(false);
    expect(isControlDeckActionIdempotent("media", "previous")).toBe(false);
    expect(isControlDeckActionIdempotent("media", "stop")).toBe(false);
    expect(isControlDeckActionIdempotent("volume", "mute_toggle")).toBe(false);
    expect(isControlDeckActionIdempotent("volume", "step_up")).toBe(false);
    expect(isControlDeckActionIdempotent("volume", "step_down")).toBe(false);
    expect(isControlDeckActionIdempotent("app_volume", "mute_toggle")).toBe(false);
    expect(isControlDeckActionIdempotent("brightness", "step_up")).toBe(false);
    expect(isControlDeckActionIdempotent("brightness", "step_down")).toBe(false);
    expect(isControlDeckActionIdempotent("mic_ptt", "toggle_mute")).toBe(false);
  });

  it("impõe limites estritos de leaseSeconds (2..30) e valida vínculos", () => {
    expect(
      controlDeckBindingTargetSchema.parse({
        kind: "mic_ptt",
        action: "hold_unmute",
        target: { leaseSeconds: 2 },
      }),
    ).toBeTruthy();
    expect(
      controlDeckBindingTargetSchema.parse({
        kind: "mic_ptt",
        action: "hold_unmute",
        target: { leaseSeconds: 30 },
      }),
    ).toBeTruthy();
    expect(
      controlDeckBindingTargetSchema.safeParse({
        kind: "mic_ptt",
        action: "hold_unmute",
        target: { leaseSeconds: 1 },
      }).success,
    ).toBe(false);
    expect(
      controlDeckBindingTargetSchema.safeParse({
        kind: "mic_ptt",
        action: "hold_unmute",
        target: { leaseSeconds: 31 },
      }).success,
    ).toBe(false);

    expect(
      controlDeckExecuteRequestSchema.safeParse({
        executionId: "exec-12345678",
        revision: "online:ver-1",
        bindingId: "bind-1",
        command: "ptt_acquire",
        leaseSeconds: 1,
      }).success,
    ).toBe(false);
    expect(
      controlDeckExecuteRequestSchema.safeParse({
        executionId: "exec-12345678",
        revision: "online:ver-1",
        bindingId: "bind-1",
        command: "ptt_acquire",
        leaseSeconds: 31,
      }).success,
    ).toBe(false);

    expect(
      controlDeckPlayerBindingSchema.safeParse({
        bindingId: "bind-1",
        label: "PTT",
        kind: "mic_ptt",
        action: "hold_unmute",
        idempotent: true,
        available: true,
        level: null,
        muted: true,
        leaseSeconds: 31,
      }).success,
    ).toBe(false);

    expect(
      controlDeckExecuteResultSchema.safeParse({
        status: "ok",
        bindingId: "bind-1",
        executionId: "exec-12345678",
        idempotent: true,
        message: "OK",
        lease: {
          leaseId: "lease-1",
          expiresAt: new Date().toISOString(),
          leaseSeconds: 1,
        },
      }).success,
    ).toBe(false);

    expect(
      controlDeckBindingCreateSchema.safeParse({
        label: "Spotify",
        kind: "app_volume",
        action: "set_level",
        target: { appName: "spotify; rm -rf /" },
      }).success,
    ).toBe(false);
    expect(
      controlDeckBindingUpdateSchema.safeParse({
        id: "bind-1",
        label: "Volume",
        kind: "volume",
        action: "set_level",
        target: { step: 5 },
        extraField: true,
      }).success,
    ).toBe(false);
  });

  it("retorna apenas estados reais sem números fictícios em unavailableControlDeckHostStatus", () => {
    const status = unavailableControlDeckHostStatus("2026-11-20T12:00:00.000Z");
    expect(status).toEqual({
      available: false,
      platform: "unsupported",
      checkedAt: "2026-11-20T12:00:00.000Z",
      capabilities: {
        shortcuts: false,
        media: false,
        volume: false,
        appVolume: false,
        brightness: false,
        mic: false,
      },
      volume: { available: false, level: null, muted: null },
      brightness: { available: false, level: null },
      mic: {
        available: false,
        muted: null,
        pttActive: false,
        leaseId: null,
        leaseExpiresAt: null,
      },
      media: { available: false, playbackState: "unknown" },
      shortcuts: [],
    });
  });

  it("valida URL loopback estrita e token >= 32 chars em getControlDeckAgentConfig (bloqueia SSRF)", () => {
    const validToken = "t".repeat(32);

    process.env.SMARTFRAME_CONTROL_DECK_TOKEN = validToken;
    for (const okUrl of [
      "http://127.0.0.1:3789",
      "http://localhost:3789",
      "http://[::1]:3789",
    ]) {
      process.env.SMARTFRAME_CONTROL_DECK_URL = okUrl;
      expect(getControlDeckAgentConfig()).toEqual({ url: okUrl, token: validToken });
    }

    for (const badUrl of [
      "https://127.0.0.1:3789",
      "http://169.254.169.254:3789",
      "http://10.0.0.1:3789",
      "http://192.168.1.20:3789",
      "http://127.0.0.2:3789",
      "http://evil.example:3789",
      "http://user:pass@127.0.0.1:3789",
      "http://127.0.0.1:3789/extra",
      "not-a-url",
    ]) {
      process.env.SMARTFRAME_CONTROL_DECK_URL = badUrl;
      expect(getControlDeckAgentConfig()).toBeNull();
    }

    process.env.SMARTFRAME_CONTROL_DECK_URL = "http://127.0.0.1:3789";
    process.env.SMARTFRAME_CONTROL_DECK_TOKEN = "curto";
    expect(getControlDeckAgentConfig()).toBeNull();
  });

  it("valida compatibilidade de controlDeckAgentExecuteSchema, layout padrão de 15 widgets e templates", () => {
    expect(
      controlDeckAgentExecuteSchema.safeParse({
        executionId: "exec_no_dev_1",
        bindingId: "b-vol",
        kind: "volume",
        action: "set_level",
        target: { step: 5 },
        idempotent: true,
        command: "set_level",
        value: 50,
      }).success,
    ).toBe(false);

    expect(
      controlDeckAgentExecuteSchema.safeParse({
        deviceId: "dev-1",
        executionId: "exec_valid_1",
        bindingId: "b-vol",
        kind: "volume",
        action: "set_level",
        target: { step: 5 },
        idempotent: true,
        command: "trigger",
      }).success,
    ).toBe(false);

    expect(
      controlDeckAgentExecuteSchema.safeParse({
        deviceId: "dev-1",
        executionId: "exec_valid_2",
        bindingId: "b-ptt",
        kind: "mic_ptt",
        action: "hold_unmute",
        target: { leaseSeconds: 10 },
        idempotent: true,
        command: "trigger",
      }).success,
    ).toBe(false);

    const layout = createDefaultDashboardGridLayout();
    for (const [boxes, maxW, maxH] of [
      [layout.landscape, 24, 24],
      [layout.portrait, 12, 40],
    ] as const) {
      expect(boxes.length).toBe(15);
      const deckItem = boxes.find((item) => item.widgetId === "controlDeck");
      expect(deckItem).toBeDefined();
      expect(deckItem!.w).toBeGreaterThanOrEqual(4);
      expect(deckItem!.h).toBeGreaterThanOrEqual(3);

      for (let i = 0; i < boxes.length; i += 1) {
        const a = boxes[i];
        expect(a.x).toBeGreaterThanOrEqual(0);
        expect(a.y).toBeGreaterThanOrEqual(0);
        expect(a.x + a.w).toBeLessThanOrEqual(maxW);
        expect(a.y + a.h).toBeLessThanOrEqual(maxH);
        for (let j = i + 1; j < boxes.length; j += 1) {
          const b = boxes[j];
          const overlaps =
            a.x < b.x + b.w &&
            a.x + a.w > b.x &&
            a.y < b.y + b.h &&
            a.y + a.h > b.y;
          expect(overlaps).toBe(false);
        }
      }
    }

    const withTiles = {
      ...defaultOnlineDashboard,
      widgets: {
        ...defaultOnlineDashboard.widgets,
        controlDeck: {
          ...defaultOnlineDashboard.widgets.controlDeck,
          enabled: true,
          title: "Deck Personalizado",
          columns: 4,
          tiles: [{ id: "tile-a", bindingId: "bind-a", label: "Play", icon: "play" as const }],
        },
      },
    };
    const templated = applyPanelTemplate(withTiles, "focus-desk");
    expect(templated.widgets.controlDeck.tiles).toEqual(withTiles.widgets.controlDeck.tiles);
  });
});
