import { describe, expect, it } from "vitest";
import { onlineDashboardSchema } from "@smartframe/contracts";
import { previewWidgetSettings } from "../apps/web/src/lib/online-editor/widget-settings";

describe("preview provider settings", () => {
  const config = onlineDashboardSchema.parse({
    widgets: {
      weather: { enabled: false, city: "Lisboa" },
      currencies: { enabled: false, pairs: ["EUR/USD"] },
      system: { enabled: false },
      rss: { enabled: false, feedUrl: "https://feeds.example.com/rss.xml", maxItems: 8 },
      devMonitor: { enabled: false, showServerMetrics: false },
      controlDeck: {
        enabled: false,
        tiles: [{ id: "tile-1", bindingId: "bind-1", label: "Mudo", icon: "mute" }],
      },
    },
    pages: [
      { id: "first", title: "Primeira", enabledWidgets: ["system", "rss"] },
      {
        id: "second",
        title: "Segunda",
        enabledWidgets: ["devMonitor", "weather", "currencies", "controlDeck"],
      },
    ],
  });

  it("includes providers enabled on any page without changing global flags", () => {
    const before = structuredClone(config);
    expect(previewWidgetSettings(config)).toEqual({
      weather: { enabled: true, city: "Lisboa" },
      currencies: { enabled: true, pairs: ["EUR/USD"] },
      system: { enabled: true },
      rss: { enabled: true, feedUrl: "https://feeds.example.com/rss.xml", maxItems: 8 },
      devMonitor: { enabled: true, showServerMetrics: false },
      controlDeck: {
        enabled: true,
        tiles: [{ id: "tile-1", bindingId: "bind-1", label: "Mudo", icon: "mute" }],
      },
    });
    expect(config).toEqual(before);
  });

  it("stops requesting data when widgets are disabled on every page and globally", () => {
    const settings = previewWidgetSettings({
      ...config,
      pages: config.pages!.map((page) => ({ ...page, enabledWidgets: ["clock"] })),
    });
    expect(Object.values(settings).every((widget) => !widget.enabled)).toBe(true);
  });

  it("preserves globally enabled providers without pages", () => {
    const settings = previewWidgetSettings(
      onlineDashboardSchema.parse({
        widgets: { system: { enabled: true } },
      }),
    );
    expect(settings.system.enabled).toBe(true);
    expect(settings.weather.enabled).toBe(true);
    expect(settings.currencies.enabled).toBe(true);
    expect(settings.rss.enabled).toBe(false);
    expect(settings.devMonitor.enabled).toBe(false);
    expect(settings.controlDeck).toEqual({ enabled: false, tiles: [] });
  });

  it("still sanitizes an invalid unsaved RSS URL when enabled only on a page", () => {
    const settings = previewWidgetSettings({
      ...config,
      widgets: {
        ...config.widgets,
        rss: { ...config.widgets.rss, feedUrl: "https://localhost./private" },
      },
    });
    expect(settings.rss.enabled).toBe(true);
    expect(settings.rss.feedUrl).toBe("");
    expect(onlineDashboardSchema.safeParse({ widgets: settings }).success).toBe(true);
  });
});
