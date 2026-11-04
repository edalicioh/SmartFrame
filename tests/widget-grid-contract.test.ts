import { describe, expect, it } from "vitest";
import {
  convertOnlineDashboardToGrid,
  createGridWidget,
  dashboardPhotoIds,
  defaultOnlineDashboard,
  findGridPosition,
  gridItemsOverlap,
  gridWidgetSchema,
  onlineDashboardSchema,
  readOnlineDashboard,
  widgetGridDashboardSchema,
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
});
