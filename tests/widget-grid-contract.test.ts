import { describe, expect, it } from "vitest";
import {
  autoArrangeDashboardGrid,
  convertOnlineDashboardToGrid,
  createDefaultDashboardGridLayout,
  createGridWidget,
  dashboardPhotoIds,
  dashboardWidgetKeys,
  defaultOnlineDashboard,
  findGridPosition,
  gridItemsOverlap,
  gridWidgetSchema,
  onlineDashboardSchema,
  readOnlineDashboard,
  readStoredOnlineDashboard,
  widgetGridDashboardSchema,
  type DashboardGridItem,
  type OnlineDashboard,
} from "@smartframe/contracts";

describe("contrato da grade modular", () => {
  it("converte o dashboard anterior de forma determinística, sem alterar a origem", () => {
    const source = onlineDashboardSchema.parse({
      timezone: "Europe/Lisbon",
      theme: "dark",
      layoutOptions: { photoPosition: "right", photoWidthPercent: 75 },
      widgets: {
        photos: { photoIds: ["p1", "p2"], fit: "contain" },
        clock: { enabled: false, format: "12h", backgroundColor: "#abc" },
        currencies: { symbols: ["BTC", "USD"] },
      },
    });
    const before = structuredClone(source);
    const result = convertOnlineDashboardToGrid(source);
    expect(source).toEqual(before);
    expect(convertOnlineDashboardToGrid(source)).toEqual(result);
    expect(result.timezone).toBe("Europe/Lisbon");
    expect(result.theme).toBe("dark");
    expect(result.widgets.find((widget) => widget.type === "photos")?.settings).toMatchObject({
      photoIds: ["p1", "p2"],
      fit: "contain",
    });
    expect(result.widgets.find((widget) => widget.type === "clock")).toMatchObject({
      enabled: false,
      appearance: { backgroundColor: "#abc" },
      settings: { format: "12h" },
    });
    expect(result.widgets.find((widget) => widget.type === "currencies")?.settings).toMatchObject({
      pairs: ["BTC/BRL", "USD/BRL"],
    });
    expect(result.layouts.landscape.items[0]).toMatchObject({ x: 6, w: 18 });
    expect(widgetGridDashboardSchema.parse(result)).toEqual(result);
  });

  it("rejeita versões futuras e não interpreta um painel v2 como v1", () => {
    const config = convertOnlineDashboardToGrid(defaultOnlineDashboard);
    expect(widgetGridDashboardSchema.safeParse({ ...config, schemaVersion: 3 }).success).toBe(
      false,
    );
    expect(() => convertOnlineDashboardToGrid(config)).toThrow();
  });

  it("valida referências, duplicatas, limites e colisões nas duas orientações", () => {
    const config = convertOnlineDashboardToGrid(defaultOnlineDashboard);
    const changed = structuredClone(config);
    changed.layouts.landscape.items[1].x = 0;
    expect(widgetGridDashboardSchema.safeParse(changed).success).toBe(false);
    changed.layouts.landscape.items[1].x = 24;
    expect(widgetGridDashboardSchema.safeParse(changed).success).toBe(false);
    changed.layouts.landscape.items[1].widgetId = "inexistente";
    expect(widgetGridDashboardSchema.safeParse(changed).success).toBe(false);
    const missing = structuredClone(config);
    missing.layouts.portrait.items.pop();
    expect(widgetGridDashboardSchema.safeParse(missing).success).toBe(false);
    const duplicated = structuredClone(config);
    duplicated.widgets.push(duplicated.widgets[0]);
    expect(widgetGridDashboardSchema.safeParse(duplicated).success).toBe(false);
  });

  it("não considera colisão de widgets desativados, mas impede ativação em posição ocupada", () => {
    const config = convertOnlineDashboardToGrid(defaultOnlineDashboard);
    config.widgets[1].enabled = false;
    config.layouts.landscape.items[1].x = 0;
    expect(widgetGridDashboardSchema.safeParse(config).success).toBe(true);
    config.widgets[1].enabled = true;
    expect(widgetGridDashboardSchema.safeParse(config).success).toBe(false);
  });

  it("calcula contato nas bordas sem considerar sobreposição", () => {
    const first = { widgetId: "a", x: 0, y: 0, w: 3, h: 3 };
    expect(gridItemsOverlap(first, { widgetId: "b", x: 3, y: 0, w: 1, h: 1 })).toBe(false);
    expect(gridItemsOverlap(first, { widgetId: "b", x: 2, y: 2, w: 1, h: 1 })).toBe(true);
  });

  it("limita o total de fotos distintas entre instâncias", () => {
    const config = convertOnlineDashboardToGrid(defaultOnlineDashboard);
    const first = config.widgets.find((widget) => widget.type === "photos")!;
    if (first.type !== "photos") throw new Error("unexpected widget");
    first.settings.photoIds = Array.from({ length: 100 }, (_, i) => `foto-${i}`);
    const second = structuredClone(first);
    second.id = "outras-fotos";
    second.enabled = false;
    second.settings.photoIds = ["foto-extra"];
    config.widgets.push(second);
    for (const orientation of ["landscape", "portrait"] as const)
      config.layouts[orientation].items.push({ widgetId: second.id, x: 0, y: 0, w: 4, h: 4 });
    expect(widgetGridDashboardSchema.safeParse(config).success).toBe(false);
    second.settings.photoIds = ["foto-1"];
    expect(widgetGridDashboardSchema.safeParse(config).success).toBe(true);
  });

  it("valida os formatos dos novos widgets e datas reais", () => {
    const common = { id: "w", enabled: true, appearance: { backgroundColor: "" } };
    expect(
      gridWidgetSchema.safeParse({
        ...common,
        type: "notes",
        settings: { title: "Casa", messages: [{ id: "a", text: "Recado" }], intervalSeconds: 10 },
      }).success,
    ).toBe(true);
    expect(
      gridWidgetSchema.safeParse({
        ...common,
        type: "tasks",
        settings: {
          title: "Hoje",
          items: [{ id: "a", text: "Comprar pão", completed: false }],
          showCompleted: false,
        },
      }).success,
    ).toBe(true);
    expect(
      gridWidgetSchema.safeParse({
        ...common,
        type: "birthdays",
        settings: {
          title: "Aniversários",
          people: [{ id: "a", name: "Ana", day: 29, month: 2 }],
          displayCount: 3,
        },
      }).success,
    ).toBe(true);
    expect(
      gridWidgetSchema.safeParse({
        ...common,
        type: "birthdays",
        settings: {
          title: "Aniversários",
          people: [{ id: "a", name: "Ana", day: 31, month: 2 }],
          displayCount: 3,
        },
      }).success,
    ).toBe(false);
    expect(
      gridWidgetSchema.safeParse({
        ...common,
        type: "birthdays",
        settings: {
          title: "Aniversários",
          people: [{ id: "a", name: "Ana", day: 29, month: 2, year: 2025 }],
          displayCount: 3,
        },
      }).success,
    ).toBe(false);
    expect(
      gridWidgetSchema.safeParse({
        ...common,
        type: "countdown",
        settings: {
          title: "Férias",
          target: { kind: "date", date: "2027-02-30" },
          display: "days",
          completedText: "Chegou!",
        },
      }).success,
    ).toBe(false);
    expect(
      gridWidgetSchema.safeParse({
        ...common,
        type: "countdown",
        settings: {
          title: "Férias",
          target: { kind: "datetime", dateTime: "2027-02-20T09:00:00-03:00" },
          display: "detailed",
          completedText: "Chegou!",
        },
      }).success,
    ).toBe(true);
  });

  it("busca espaço livre sem mover outros widgets e recusa tamanhos inválidos", () => {
    const occupied = [{ widgetId: "a", x: 0, y: 0, w: 8, h: 24 }];
    expect(findGridPosition("landscape", "b", 4, 4, occupied)).toEqual({
      widgetId: "b",
      x: 8,
      y: 0,
      w: 4,
      h: 4,
    });
    expect(findGridPosition("portrait", "b", 13, 4, occupied)).toBeNull();
    expect(findGridPosition("portrait", "b", 1.5, 4, occupied)).toBeNull();
    expect(findGridPosition("landscape", "b", 20, 4, occupied)).toBeNull();
  });

  it("recusa cartões menores que o mínimo do catálogo", () => {
    const config = convertOnlineDashboardToGrid(defaultOnlineDashboard);
    config.layouts.landscape.items[0].w = 3;
    expect(widgetGridDashboardSchema.safeParse(config).success).toBe(false);
  });

  it("cria instâncias independentes com padrões válidos e rejeita datas inválidas", () => {
    for (const type of [
      "photos",
      "clock",
      "weather",
      "currencies",
      "calendar",
      "notes",
      "countdown",
      "birthdays",
      "tasks",
    ] as const) {
      const widget = createGridWidget(type, `widget-${type}`, "2027-01-01");
      expect(widget.id).toBe(`widget-${type}`);
      expect(widget.type).toBe(type);
      expect(gridWidgetSchema.safeParse(widget).success).toBe(true);
    }
    expect(() => createGridWidget("countdown", "widget", "2027-02-30")).toThrow();
    expect(() => createGridWidget("tasks", "invalid id", "2027-01-01")).toThrow();
  });

  it("lê cada versão sem conversão implícita e reúne mídias distintas", () => {
    const old = onlineDashboardSchema.parse({ widgets: { photos: { photoIds: ["a", "b"] } } });
    expect(readOnlineDashboard(old)).toEqual({ version: 1, config: old });
    const grid = convertOnlineDashboardToGrid(old);
    expect(readOnlineDashboard(grid)).toEqual({ version: 2, config: grid });
    expect(dashboardPhotoIds(grid)).toEqual(["a", "b"]);
    expect(dashboardPhotoIds(old)).toEqual(["a", "b"]);
    expect(() => readOnlineDashboard({ ...grid, schemaVersion: 3 })).toThrow();
    expect(() => readOnlineDashboard({ schemaVersion: 1 })).toThrow();
  });

  it("preserva aparência em camadas na conversão e ignora campos de página no widget", () => {
    const source = onlineDashboardSchema.parse({
      appearance: { preset: "seamless", cornerRadius: 0, widgetSpacing: 0, pageEdgePadding: 0 },
      widgets: {
        clock: {
          backgroundColor: "#112233",
          appearance: { preset: "flat", cornerRadius: 12, border: false },
        },
      },
    });
    const grid = convertOnlineDashboardToGrid(source);
    expect(grid.appearance).toMatchObject({
      preset: "seamless",
      cornerRadius: 0,
      widgetSpacing: 0,
      pageEdgePadding: 0,
    });
    const clockWidget = grid.widgets.find((widget) => widget.type === "clock");
    expect(clockWidget?.appearance).toEqual({
      backgroundColor: "#112233",
      preset: "flat",
      cornerRadius: 12,
      border: false,
    });

    const stripped = gridWidgetSchema.parse({
      id: "w-clock",
      type: "clock",
      enabled: true,
      appearance: {
        backgroundColor: "",
        cornerRadius: 6,
        widgetSpacing: 20,
        pageEdgePadding: 24,
      },
      settings: {
        cardSize: "normal",
        format: "24h",
        showDate: false,
        size: "normal",
        color: "",
      },
    });
    expect(stripped.appearance).toEqual({ backgroundColor: "", cornerRadius: 6 });
    expect(
      gridWidgetSchema.safeParse({
        ...stripped,
        appearance: { backgroundColor: "", unknownField: true },
      }).success,
    ).toBe(false);
  });

  it("gera grade padrão válida para todos os 10 widgets e reorganiza colisões", () => {
    const defaultGrid = createDefaultDashboardGridLayout(defaultOnlineDashboard);
    expect(defaultGrid.landscape).toHaveLength(dashboardWidgetKeys.length);
    expect(defaultGrid.portrait).toHaveLength(dashboardWidgetKeys.length);

    //Mesmo ativando todos os 10 widgets simultaneamente, o layout padrão continua válido e sem sobreposições.
    const allEnabled = onlineDashboardSchema.parse({
      widgets: Object.fromEntries(dashboardWidgetKeys.map((key) => [key, { enabled: true }])),
      gridLayout: { ...defaultGrid, enabled: true },
    });
    expect(allEnabled.gridLayout?.enabled).toBe(true);

    // Introduz colisões propositais e reorganiza sem colisões nas duas orientações.
    const conflicted = {
      ...allEnabled,
      gridLayout: {
        enabled: true,
        landscape: dashboardWidgetKeys.map((widgetId) => ({
          widgetId,
          x: 0,
          y: 0,
          w: 6,
          h: 4,
        })),
        portrait: dashboardWidgetKeys.map((widgetId) => ({
          widgetId,
          x: 0,
          y: 0,
          w: 6,
          h: 4,
        })),
      },
    };
    const arranged = autoArrangeDashboardGrid(conflicted);
    expect(() => onlineDashboardSchema.parse(arranged)).not.toThrow();
    expect(arranged.gridLayout?.landscape).toHaveLength(dashboardWidgetKeys.length);
    expect(arranged.gridLayout?.portrait).toHaveLength(dashboardWidgetKeys.length);
  });

  it("organiza a grade sem validar campos do rascunho que ainda estão sendo editados", () => {
    const base = onlineDashboardSchema.parse({});
    const draft = {
      ...base,
      widgets: {
        ...base.widgets,
        weather: { ...base.widgets.weather, city: "" },
      },
    };
    expect(() => onlineDashboardSchema.parse(draft)).toThrow();

    const arranged = autoArrangeDashboardGrid(draft);
    expect(arranged.widgets.weather.city).toBe("");
    expect(() => onlineDashboardSchema.parse(arranged)).toThrow();
    for (const orientation of ["landscape", "portrait"] as const) {
      const items = arranged.gridLayout![orientation];
      for (const key of dashboardWidgetKeys.filter((key) => arranged.widgets[key].enabled)) {
        expect(items.some((item) => item.widgetId === key)).toBe(true);
      }
    }
  });

  it("preserva posições salvas de widgets desativados ao organizar", () => {
    const base = onlineDashboardSchema.parse({});
    const defaultGrid = createDefaultDashboardGridLayout(base);
    const customLandscape: DashboardGridItem = { widgetId: "clock", x: 18, y: 10, w: 5, h: 8 };
    const customPortrait: DashboardGridItem = { widgetId: "clock", x: 6, y: 30, w: 6, h: 8 };
    const disabled: OnlineDashboard = {
      ...base,
      widgets: { ...base.widgets, clock: { ...base.widgets.clock, enabled: false } },
      gridLayout: {
        enabled: true,
        landscape: defaultGrid.landscape.map((item) =>
          item.widgetId === "clock" ? customLandscape : item,
        ),
        portrait: defaultGrid.portrait.map((item) =>
          item.widgetId === "clock" ? customPortrait : item,
        ),
      },
    };

    const arranged = autoArrangeDashboardGrid(disabled);
    for (const orientation of ["landscape", "portrait"] as const) {
      const items = arranged.gridLayout![orientation];
      const saved = items.filter((item) => item.widgetId === "clock");
      expect(saved).toEqual([orientation === "landscape" ? customLandscape : customPortrait]);
      for (const key of dashboardWidgetKeys.filter((key) => arranged.widgets[key].enabled)) {
        expect(items.some((item) => item.widgetId === key)).toBe(true);
      }
    }

    const allDisabled: OnlineDashboard = {
      ...base,
      widgets: Object.fromEntries(
        dashboardWidgetKeys.map((key) => [key, { ...base.widgets[key], enabled: false }]),
      ) as OnlineDashboard["widgets"],
      gridLayout: { ...defaultGrid, enabled: true },
    };
    const preserved = autoArrangeDashboardGrid(allDisabled);
    expect(preserved.gridLayout!.landscape).toEqual(defaultGrid.landscape);
    expect(preserved.gridLayout!.portrait).toEqual(defaultGrid.portrait);
  });

  it("repara na leitura apenas grades ativas incompletas ou sobrepostas", () => {
    const broken = {
      widgets: { notes: { enabled: true } },
      gridLayout: { enabled: true, landscape: [], portrait: [] },
    };
    // A gravação continua estrita: a configuração incompleta não passa no schema.
    expect(() => onlineDashboardSchema.parse(broken)).toThrow();

    const repaired = readStoredOnlineDashboard(broken);
    expect(() => onlineDashboardSchema.parse(repaired)).not.toThrow();
    for (const orientation of ["landscape", "portrait"] as const) {
      const items = repaired.gridLayout![orientation];
      for (const key of dashboardWidgetKeys.filter((key) => repaired.widgets[key].enabled)) {
        expect(items.some((item) => item.widgetId === key)).toBe(true);
      }
    }

    const base = createDefaultDashboardGridLayout(defaultOnlineDashboard);
    const overlapping = readStoredOnlineDashboard({
      gridLayout: {
        enabled: true,
        landscape: base.landscape.map((item) =>
          item.widgetId === "clock" ? { ...item, x: 0, y: 0 } : item,
        ),
        portrait: base.portrait,
      },
    });
    expect(() => onlineDashboardSchema.parse(overlapping)).not.toThrow();

    // Configurações válidas voltam intactas.
    const valid = onlineDashboardSchema.parse({
      gridLayout: { ...createDefaultDashboardGridLayout(defaultOnlineDashboard), enabled: true },
    });
    expect(readStoredOnlineDashboard(valid)).toEqual(valid);

    // Modo clássico e entradas estruturalmente inválidas continuam sendo rejeitados.
    expect(() =>
      readStoredOnlineDashboard({
        gridLayout: {
          enabled: false,
          landscape: [{ widgetId: "photos", x: 23, y: 0, w: 4, h: 4 }],
        },
      }),
    ).toThrow();
    expect(() => readStoredOnlineDashboard({ theme: "neon" })).toThrow();
  });
});
