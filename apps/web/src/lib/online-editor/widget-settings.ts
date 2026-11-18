import {
  isSafePublicHttpsUrl,
  type DashboardWidgetKey,
  type OnlineDashboard,
} from "@smartframe/contracts";

/** Fetch data for every page, matching the published player's provider selection. */
export function previewWidgetSettings(config: OnlineDashboard) {
  const pageEnabled = new Set(config.pages?.flatMap((page) => page.enabledWidgets) ?? []);
  const enabled = (key: DashboardWidgetKey) => config.widgets[key].enabled || pageEnabled.has(key);
  return {
    weather: { enabled: enabled("weather"), city: config.widgets.weather.city },
    currencies: { enabled: enabled("currencies"), pairs: config.widgets.currencies.pairs },
    system: { enabled: enabled("system") },
    rss: {
      enabled: enabled("rss"),
      feedUrl: isSafePublicHttpsUrl(config.widgets.rss.feedUrl) ? config.widgets.rss.feedUrl : "",
      maxItems: config.widgets.rss.maxItems,
    },
    devMonitor: {
      enabled: enabled("devMonitor"),
      showServerMetrics: config.widgets.devMonitor.showServerMetrics,
    },
  };
}
