import { describe, expect, it } from "vitest";
import {
  createDefaultDashboardGridLayout,
  dashboardWidgetKeys,
  gridItemsOverlap,
  onlineDashboardSchema,
  type OnlineDashboard,
} from "@smartframe/contracts";
import {
  ensureGridLayoutValid,
  setGridLayoutEnabled,
} from "../apps/web/src/lib/online-editor/grid-layout";

type Orientation = "landscape" | "portrait";

const base = onlineDashboardSchema.parse({});
const complete: OnlineDashboard = {
  ...base,
  gridLayout: { ...createDefaultDashboardGridLayout(base), enabled: true },
};
const enabledKeys = dashboardWidgetKeys.filter((key) => complete.widgets[key].enabled);

function withOverlap(config: OnlineDashboard, orientation: Orientation): OnlineDashboard {
  const items = config.gridLayout![orientation].map((item) => ({ ...item }));
  const clock = items.find((item) => item.widgetId === "clock")!;
  // Fotos occupies the origin in the default layout, so this forces a collision.
  clock.x = 0;
  clock.y = 0;
  return { ...config, gridLayout: { ...config.gridLayout!, [orientation]: items } };
}

function withoutPosition(config: OnlineDashboard, orientation: Orientation): OnlineDashboard {
  return {
    ...config,
    gridLayout: {
      ...config.gridLayout!,
      [orientation]: config.gridLayout![orientation].filter((item) => item.widgetId !== "clock"),
    },
  };
}

function expectEnabledCoverage(config: OnlineDashboard) {
  for (const orientation of ["landscape", "portrait"] as const) {
    const items = config.gridLayout![orientation];
    for (const key of enabledKeys) {
      expect(
        items.some((item) => item.widgetId === key),
        `${key} em ${orientation}`,
      ).toBe(true);
    }
    const active = items.filter((item) => config.widgets[item.widgetId].enabled);
    active.forEach((item, index) => {
      expect(
        active.slice(0, index).some((other) => gridItemsOverlap(item, other)),
        `${item.widgetId} sem sobreposição em ${orientation}`,
      ).toBe(false);
    });
  }
}

describe("setGridLayoutEnabled", () => {
  const stacked = onlineDashboardSchema.parse({
    ...complete,
    smartStack: {
      enabled: true,
      title: "Minha pilha",
      widgets: ["photos", "clock"],
      intervalSeconds: 20,
      showIndicators: false,
    },
  });

  it("desativa a pilha junto com a grade sem perder suas configurações", () => {
    const next = ensureGridLayoutValid(setGridLayoutEnabled(stacked, false));
    expect(next.gridLayout).toEqual({ ...stacked.gridLayout, enabled: false });
    expect(next.smartStack).toEqual({ ...stacked.smartStack, enabled: false });
    expect(next.widgets).toBe(stacked.widgets);
    expect(stacked.smartStack?.enabled).toBe(true);
    expect(() => onlineDashboardSchema.parse(next)).not.toThrow();

    const restored = ensureGridLayoutValid(setGridLayoutEnabled(next, true));
    expect(restored.gridLayout?.enabled).toBe(true);
    expect(restored.smartStack).toBe(next.smartStack);
    expect(() => onlineDashboardSchema.parse(restored)).not.toThrow();
  });

  it.each([false, true])(
    "altera só a página atual, incluindo pilha herdada (própria: %s)",
    (ownStack) => {
      const config: OnlineDashboard = {
        ...stacked,
        pages: [
          {
            id: "first",
            title: "Primeira",
            enabledWidgets: ["photos", "clock"],
            ...(ownStack ? { smartStack: { ...stacked.smartStack!, title: "Pilha local" } } : {}),
          },
          { id: "second", title: "Segunda", enabledWidgets: ["photos", "clock"] },
        ],
      };
      const snapshot = structuredClone(config);
      const next = ensureGridLayoutValid(setGridLayoutEnabled(config, false, "first"));

      expect(next.pages![0].gridLayout).toEqual({ ...stacked.gridLayout, enabled: false });
      expect(next.pages![0].smartStack).toEqual({
        ...(config.pages![0].smartStack ?? stacked.smartStack),
        enabled: false,
      });
      expect(next.pages![1]).toBe(config.pages![1]);
      expect(next.gridLayout).toBe(config.gridLayout);
      expect(next.smartStack).toBe(config.smartStack);
      expect(config).toEqual(snapshot);
      expect(() => onlineDashboardSchema.parse(next)).not.toThrow();
    },
  );

  it("cria a grade ao ativar o modo livre em um painel clássico", () => {
    const next = ensureGridLayoutValid(setGridLayoutEnabled(base, true));
    expect(next.gridLayout?.enabled).toBe(true);
    expect(next).not.toHaveProperty("smartStack");
    expect(() => onlineDashboardSchema.parse(next)).not.toThrow();
  });
});

describe("ensureGridLayoutValid", () => {
  it("repara as duas orientações em uma única chamada, sem validar estado intermediário", () => {
    const broken = withOverlap(withOverlap(complete, "landscape"), "portrait");
    const snapshot = JSON.stringify(broken);

    let repaired: OnlineDashboard | undefined;
    expect(() => {
      repaired = ensureGridLayoutValid(broken);
    }).not.toThrow();

    expect(JSON.stringify(broken)).toBe(snapshot);
    expect(repaired).not.toBe(broken);
    expect(() => onlineDashboardSchema.parse(repaired)).not.toThrow();
    expectEnabledCoverage(repaired!);
  });

  it("organiza apenas a orientação inválida e preserva a outra como está armazenada", () => {
    const landscapeBroken = withOverlap(complete, "landscape");
    const sceneFirst = ensureGridLayoutValid(landscapeBroken);
    expect(sceneFirst.gridLayout!.portrait).toEqual(complete.gridLayout!.portrait);
    expect(sceneFirst.gridLayout!.landscape).not.toEqual(landscapeBroken.gridLayout!.landscape);
    expect(() => onlineDashboardSchema.parse(sceneFirst)).not.toThrow();

    const portraitBroken = withOverlap(complete, "portrait");
    const sceneSecond = ensureGridLayoutValid(portraitBroken);
    expect(sceneSecond.gridLayout!.landscape).toEqual(complete.gridLayout!.landscape);
    expect(sceneSecond.gridLayout!.portrait).not.toEqual(portraitBroken.gridLayout!.portrait);
    expect(() => onlineDashboardSchema.parse(sceneSecond)).not.toThrow();
  });

  it("adiciona posição ausente em ambas as orientações", () => {
    const broken = withoutPosition(withoutPosition(complete, "landscape"), "portrait");
    const repaired = ensureGridLayoutValid(broken);
    expect(() => onlineDashboardSchema.parse(repaired)).not.toThrow();
    expectEnabledCoverage(repaired);
  });

  it("repara posições fora da grade ou menores que o mínimo", () => {
    const items = complete.gridLayout!.landscape.map((item) => ({ ...item }));
    const clock = items.find((item) => item.widgetId === "clock")!;
    clock.x = 22;
    clock.w = 2;
    const broken: OnlineDashboard = {
      ...complete,
      gridLayout: { ...complete.gridLayout!, landscape: items },
    };
    const repaired = ensureGridLayoutValid(broken);
    expect(repaired.gridLayout!.landscape).not.toEqual(items);
    expect(() => onlineDashboardSchema.parse(repaired)).not.toThrow();
    expectEnabledCoverage(repaired);
  });

  it("repara o slot compartilhado quando a âncora da pilha não comporta todos os membros", () => {
    const config = onlineDashboardSchema.parse({
      widgets: {
        photos: { enabled: true },
        clock: { enabled: true },
        weather: { enabled: false },
        currencies: { enabled: false },
        calendar: { enabled: false },
        notes: { enabled: false },
        countdown: { enabled: false },
        birthdays: { enabled: false },
        tasks: { enabled: false },
        pomodoro: { enabled: false },
      },
      smartStack: {
        enabled: true,
        title: "Pilha",
        widgets: ["photos", "clock"],
        intervalSeconds: 0,
        showIndicators: true,
      },
      gridLayout: {
        enabled: true,
        landscape: [
          { widgetId: "clock", x: 0, y: 0, w: 3, h: 2 },
          { widgetId: "photos", x: 3, y: 0, w: 14, h: 18 },
        ],
        portrait: [
          { widgetId: "clock", x: 0, y: 0, w: 3, h: 2 },
          { widgetId: "photos", x: 3, y: 0, w: 8, h: 18 },
        ],
      },
    });

    // Fotos é a âncora e já comporta todos os mínimos, então nada muda.
    expect(ensureGridLayoutValid(config)).toBe(config);

    // Reordenar a pilha torna o relógio a âncora; o slot precisa crescer até 4x4.
    const reordered: OnlineDashboard = {
      ...config,
      smartStack: { ...config.smartStack!, widgets: ["clock", "photos"] },
    };
    const repaired = ensureGridLayoutValid(reordered);
    expect(repaired).not.toBe(reordered);
    for (const orientation of ["landscape", "portrait"] as const) {
      const clock = repaired.gridLayout![orientation].find((item) => item.widgetId === "clock")!;
      const photos = repaired.gridLayout![orientation].find((item) => item.widgetId === "photos")!;
      expect(clock.w).toBeGreaterThanOrEqual(4);
      expect(clock.h).toBeGreaterThanOrEqual(4);
      expect(photos).toMatchObject({ x: clock.x, y: clock.y, w: clock.w, h: clock.h });
    }
    expect(() => onlineDashboardSchema.parse(repaired)).not.toThrow();
  });

  it("não reorganiza widgets que só sobrepõem a posição antiga de membro secundário da pilha", () => {
    const config = onlineDashboardSchema.parse({
      widgets: {
        photos: { enabled: true },
        clock: { enabled: true },
        weather: { enabled: true },
        currencies: { enabled: false },
        calendar: { enabled: false },
      },
      smartStack: {
        enabled: true,
        title: "Pilha",
        widgets: ["clock", "weather"],
      },
      gridLayout: {
        enabled: true,
        landscape: [
          { widgetId: "clock", x: 0, y: 0, w: 4, h: 4 },
          { widgetId: "weather", x: 8, y: 8, w: 4, h: 4 },
          { widgetId: "photos", x: 8, y: 8, w: 4, h: 4 },
        ],
        portrait: [
          { widgetId: "clock", x: 0, y: 0, w: 4, h: 4 },
          { widgetId: "weather", x: 6, y: 6, w: 4, h: 4 },
          { widgetId: "photos", x: 6, y: 6, w: 4, h: 4 },
        ],
      },
    });

    expect(ensureGridLayoutValid(config)).toBe(config);
  });

  it("repara a grade herdada quando a página ativa um widget sem posição", () => {
    const inheritedGrid = {
      ...complete.gridLayout!,
      landscape: complete.gridLayout!.landscape.filter((item) => item.widgetId !== "clock"),
      portrait: complete.gridLayout!.portrait.filter((item) => item.widgetId !== "clock"),
    };
    const config: OnlineDashboard = {
      ...complete,
      widgets: { ...complete.widgets, clock: { ...complete.widgets.clock, enabled: false } },
      gridLayout: inheritedGrid,
      pages: [
        {
          id: "page-0",
          title: "Principal",
          enabledWidgets: ["photos", "clock"],
        },
      ],
    };

    const repaired = ensureGridLayoutValid(config);
    expect(repaired).not.toBe(config);
    const pageGrid = repaired.pages![0].gridLayout!;
    expect(pageGrid).toBeDefined();
    for (const orientation of ["landscape", "portrait"] as const) {
      expect(pageGrid[orientation].some((item) => item.widgetId === "clock")).toBe(true);
    }
    expect(() => onlineDashboardSchema.parse(repaired)).not.toThrow();
  });

  it("repara a grade herdada quando um widget ativado na página sobrepõe outro", () => {
    const inheritedGrid = {
      ...complete.gridLayout!,
      landscape: complete.gridLayout!.landscape.map((item) =>
        item.widgetId === "clock" ? { ...item, x: 0, y: 0 } : { ...item },
      ),
      portrait: complete.gridLayout!.portrait.map((item) =>
        item.widgetId === "clock" ? { ...item, x: 0, y: 0 } : { ...item },
      ),
    };
    const config: OnlineDashboard = {
      ...complete,
      widgets: { ...complete.widgets, clock: { ...complete.widgets.clock, enabled: false } },
      gridLayout: inheritedGrid,
      pages: [
        {
          id: "page-0",
          title: "Principal",
          enabledWidgets: ["photos", "clock"],
        },
      ],
    };

    const repaired = ensureGridLayoutValid(config);
    expect(repaired).not.toBe(config);
    const pageGrid = repaired.pages![0].gridLayout!;
    expect(pageGrid).toBeDefined();
    for (const orientation of ["landscape", "portrait"] as const) {
      const photos = pageGrid[orientation].find((item) => item.widgetId === "photos")!;
      const clock = pageGrid[orientation].find((item) => item.widgetId === "clock")!;
      expect(gridItemsOverlap(photos, clock)).toBe(false);
    }
    expect(() => onlineDashboardSchema.parse(repaired)).not.toThrow();
  });

  it("tolera campos incompletos do rascunho ao reparar a grade", () => {
    const broken = withoutPosition(withOverlap(complete, "portrait"), "landscape");
    const draft: OnlineDashboard = {
      ...broken,
      widgets: {
        ...broken.widgets,
        weather: { ...broken.widgets.weather, city: "" },
      },
    };
    const snapshot = JSON.stringify(draft);

    let repaired: OnlineDashboard | undefined;
    expect(() => {
      repaired = ensureGridLayoutValid(draft);
    }).not.toThrow();

    expect(JSON.stringify(draft)).toBe(snapshot);
    expect(repaired!.widgets.weather.city).toBe("");
    expectEnabledCoverage(repaired!);
    // A validação completa continua sendo responsabilidade do fluxo de salvar.
    expect(() => onlineDashboardSchema.parse(repaired)).toThrow();
  });

  it("não altera uma grade válida", () => {
    expect(ensureGridLayoutValid(complete)).toBe(complete);
  });

  it("ignora grades desativadas", () => {
    const classic: OnlineDashboard = {
      ...base,
      gridLayout: {
        enabled: false,
        landscape: [{ widgetId: "clock", x: 0, y: 0, w: 10, h: 6 }],
        portrait: [],
      },
    };
    expect(ensureGridLayoutValid(classic)).toBe(classic);
  });
});
