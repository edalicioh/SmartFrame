import { describe, expect, it } from "vitest";
import { defaultOnlineDashboard, onlineDashboardSchema } from "@smartframe/contracts";

describe("contrato do dashboard online", () => {
  it("define defaults de layout e atualização", () => {
    expect(defaultOnlineDashboard.layoutOptions.photoWidthPercent).toBe(62);
    expect(defaultOnlineDashboard.refreshSeconds).toBe(15);
    expect(defaultOnlineDashboard.widgets.clock.showDate).toBe(false);
    expect(
      onlineDashboardSchema.parse({ widgets: { clock: { showDate: true } } }).widgets.clock
        .showDate,
    ).toBe(false);
  });

  it("aceita no máximo 100 IDs de foto únicos", () => {
    const photoIds = Array.from({ length: 100 }, (_, index) => `photo-${index}`);
    expect(onlineDashboardSchema.safeParse({ widgets: { photos: { photoIds } } }).success).toBe(
      true,
    );
    expect(
      onlineDashboardSchema.safeParse({ widgets: { photos: { photoIds: [...photoIds, "extra"] } } })
        .success,
    ).toBe(false);
    expect(
      onlineDashboardSchema.safeParse({ widgets: { photos: { photoIds: ["same", "same"] } } })
        .success,
    ).toBe(false);
  });

  it("preserva o estilo padrão de publicações antigas e valida fundo e tamanho por widget", () => {
    const original = onlineDashboardSchema.parse({ widgets: { clock: { format: "12h" } } });
    for (const key of ["clock", "weather", "currencies", "calendar"] as const) {
      expect(original.widgets[key].backgroundColor).toBe("");
      expect(original.widgets[key].cardSize).toBe("normal");
      expect(
        onlineDashboardSchema.safeParse({ widgets: { [key]: { cardSize: "huge" } } }).success,
      ).toBe(false);
      expect(
        onlineDashboardSchema.safeParse({ widgets: { [key]: { backgroundColor: "red" } } }).success,
      ).toBe(false);
    }
    expect(original.widgets.photos.backgroundColor).toBe("");
    const updated = onlineDashboardSchema.parse({
      widgets: {
        photos: { backgroundColor: "#123456" },
        clock: { backgroundColor: "#abc", cardSize: "large" },
        weather: { backgroundColor: "#ffffff", cardSize: "small" },
        currencies: { backgroundColor: "#222326", cardSize: "large" },
        calendar: { backgroundColor: "#000000", cardSize: "small" },
      },
    });
    expect(onlineDashboardSchema.parse(updated)).toEqual(updated);
  });

  it("migra as moedas antigas e permite pares com destinos diferentes", () => {
    const legacy = onlineDashboardSchema.parse({
      widgets: { currencies: { symbols: ["BTC", "USD"] } },
    });
    expect(legacy.widgets.currencies.pairs).toEqual(["BTC/BRL", "USD/BRL"]);
    expect(legacy.widgets.currencies).not.toHaveProperty("symbols");
    const config = onlineDashboardSchema.parse({
      widgets: {
        currencies: {
          pairs: ["USD/BRL", "BTC/USD", "ETH/EUR", "BRL/BTC"],
          displayCount: 3,
        },
      },
    });
    expect(config.widgets.currencies.pairs).toHaveLength(4);
    expect(config.widgets.currencies.displayCount).toBe(3);
    expect(onlineDashboardSchema.parse(config)).toEqual(config);
  });

  it("rejeita pares inválidos, duplicados e quantidades fora dos limites", () => {
    for (const currencies of [
      { pairs: [] },
      { pairs: ["USD/BRL", "USD/BRL"] },
      { pairs: ["USD/USD"] },
      { pairs: ["XYZ/BRL"] },
      { pairs: ["USD/BRL/ETH"] },
      { pairs: ["usd/brl"] },
      { displayCount: 0 },
      { displayCount: 5 },
      { displayCount: 1.5 },
      { pairs: Array.from({ length: 21 }, () => "BTC/USD") },
    ])
      expect(onlineDashboardSchema.safeParse({ widgets: { currencies } }).success).toBe(false);
  });

  it("rejeita valores fora dos limites e propriedades não previstas", () => {
    expect(onlineDashboardSchema.safeParse({ refreshSeconds: 9 }).success).toBe(false);
    expect(
      onlineDashboardSchema.safeParse({ layoutOptions: { photoWidthPercent: 39 } }).success,
    ).toBe(false);
    expect(onlineDashboardSchema.safeParse({ credential: "secret" }).success).toBe(false);
  });
});
