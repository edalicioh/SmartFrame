import { describe, expect, it } from "vitest";
import {
  createDefaultDashboardGridLayout,
  dashboardWidgetKeys,
  gridItemsOverlap,
  onlineDashboardSchema,
  type OnlineDashboard,
} from "@smartframe/contracts";
import { ensureGridLayoutValid } from "../apps/web/src/lib/online-editor/grid-layout";

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
