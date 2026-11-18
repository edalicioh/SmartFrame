import { z } from "zod";
import ipaddr from "ipaddr.js";
import { onlineCurrenciesSchema } from "./currencies";
import {
  scopedAppearanceFields,
  widgetAppearanceOverrideSchema,
  widgetBackground,
  widgetCardSize,
} from "./widget-style";

const color = z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
const interval = (min: number, fallback: number) =>
  z.number().int().min(min).max(3600).default(fallback);

export function isPublicIpAddress(value: string): boolean {
  try {
    return ipaddr.parse(value).range() === "unicast";
  } catch {
    return false;
  }
}

/** Hostname validation is complemented by DNS validation at the RSS connection. */
export function isSafePublicHttpsUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return false;
    const host = parsed.hostname
      .toLowerCase()
      .replace(/^\[(.*)\]$/, "$1")
      .replace(/\.$/, "");
    if (
      !host ||
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host.endsWith(".local") ||
      host.endsWith(".internal") ||
      host.endsWith(".home") ||
      host.endsWith(".lan")
    ) {
      return false;
    }
    if (ipaddr.isValid(host)) return isPublicIpAddress(host);
    return host.includes(".");
  } catch {
    return false;
  }
}

const validTimezoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("pt-BR", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, "Fuso horário inválido");

export const defaultWorldClockZones = [
  { id: "zone-utc", label: "Londres (UTC)", timezone: "UTC" },
  { id: "zone-ny", label: "Nova York", timezone: "America/New_York" },
  { id: "zone-tokyo", label: "Tóquio", timezone: "Asia/Tokyo" },
];

export const worldClockZoneSchema = z
  .object({
    id: z.string().min(1).max(128),
    label: z.string().trim().min(1).max(40),
    timezone: validTimezoneSchema,
  })
  .strict();

export const devMonitorItemSchema = z
  .object({
    id: z.string().min(1).max(128),
    name: z.string().trim().min(1).max(60),
    category: z.enum(["ci", "ai", "service", "deploy"]).default("service"),
    status: z.enum(["healthy", "running", "warning", "failing", "idle"]).default("healthy"),
    detail: z.string().trim().max(120).default(""),
  })
  .strict();

export const dashboardWidgetKeys = [
  "photos",
  "clock",
  "weather",
  "currencies",
  "calendar",
  "notes",
  "countdown",
  "birthdays",
  "tasks",
  "pomodoro",
  "system",
  "worldClock",
  "rss",
  "devMonitor",
] as const;

export type DashboardWidgetKey = (typeof dashboardWidgetKeys)[number];
export const dashboardWidgetKeySchema = z.enum(dashboardWidgetKeys);

export const gridDimensions = {
  landscape: { columns: 24, rows: 24 },
  portrait: { columns: 12, rows: 40 },
} as const;

/** Shared metadata; widget implementations themselves remain trusted project code. */
export const gridWidgetCatalog = {
  photos: { label: "Fotos", minWidth: 4, minHeight: 4 },
  clock: { label: "Relógio", minWidth: 3, minHeight: 2 },
  weather: { label: "Clima", minWidth: 3, minHeight: 2 },
  currencies: { label: "Moedas", minWidth: 3, minHeight: 2 },
  calendar: { label: "Calendário", minWidth: 4, minHeight: 4 },
  notes: { label: "Recados", minWidth: 3, minHeight: 2 },
  countdown: { label: "Contagem regressiva", minWidth: 3, minHeight: 2 },
  birthdays: { label: "Aniversários", minWidth: 3, minHeight: 2 },
  tasks: { label: "Tarefas", minWidth: 3, minHeight: 2 },
  pomodoro: { label: "Pomodoro", minWidth: 3, minHeight: 3 },
  system: { label: "Sistema", minWidth: 4, minHeight: 3 },
  worldClock: { label: "Relógio mundial", minWidth: 3, minHeight: 3 },
  rss: { label: "Feed RSS", minWidth: 4, minHeight: 3 },
  devMonitor: { label: "Monitor Dev/IA", minWidth: 4, minHeight: 3 },
} as const satisfies Record<
  DashboardWidgetKey,
  { label: string; minWidth: number; minHeight: number }
>;

export type GridBox = { x: number; y: number; w: number; h: number };

export function gridItemsOverlap<A extends GridBox, B extends GridBox>(a: A, b: B): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export const dashboardGridItemSchema = z
  .object({
    widgetId: dashboardWidgetKeySchema,
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
    w: z.number().int().positive(),
    h: z.number().int().positive(),
  })
  .strict();

export type DashboardGridItem = z.infer<typeof dashboardGridItemSchema>;

export const dashboardGridLayoutSchema = z
  .object({
    enabled: z.boolean().default(false),
    landscape: z.array(dashboardGridItemSchema).max(dashboardWidgetKeys.length).default([]),
    portrait: z.array(dashboardGridItemSchema).max(dashboardWidgetKeys.length).default([]),
  })
  .strict();

export type DashboardGridLayout = z.infer<typeof dashboardGridLayoutSchema>;

export const dashboardLayoutOptionsSchema = z
  .object({
    photoPosition: z.enum(["left", "right"]).default("left"),
    photoWidthPercent: z.number().int().min(40).max(75).default(62),
  })
  .strict();

export const smartStackSchema = z
  .object({
    enabled: z.boolean().default(false),
    title: z.string().trim().min(1).max(60).default("Smart Stack"),
    widgets: z
      .array(dashboardWidgetKeySchema)
      .max(12)
      .refine((keys) => new Set(keys).size === keys.length, "Widgets duplicados no Smart Stack")
      .default([]),
    intervalSeconds: z
      .number()
      .int()
      .min(0)
      .max(3600)
      .refine((value) => value === 0 || value >= 5, "Intervalo do Smart Stack deve ser 0 ou >= 5s")
      .default(10),
    showIndicators: z.boolean().default(true),
  })
  .strict();

export type SmartStackConfig = z.infer<typeof smartStackSchema>;

export const dashboardPageSchema = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    title: z.string().trim().min(1).max(60),
    enabledWidgets: z
      .array(dashboardWidgetKeySchema)
      .max(dashboardWidgetKeys.length)
      .refine((keys) => new Set(keys).size === keys.length, "Widgets duplicados na página"),
    layoutOptions: dashboardLayoutOptionsSchema.optional(),
    gridLayout: dashboardGridLayoutSchema.optional(),
    smartStack: smartStackSchema.optional(),
  })
  .strict();

export type DashboardPage = z.infer<typeof dashboardPageSchema>;

export const pageSettingsSchema = z
  .object({
    autoRotateSeconds: z
      .number()
      .int()
      .min(0)
      .max(600)
      .refine((value) => value === 0 || value >= 5, "Intervalo entre páginas deve ser 0 ou >= 5s")
      .default(0),
    showIndicators: z.boolean().default(true),
    swipeEnabled: z.boolean().default(true),
  })
  .strict();

export type PageSettings = z.infer<typeof pageSettingsSchema>;

function validateGridLayoutForScope(
  gridLayout: DashboardGridLayout | undefined,
  isEnabledWidget: (key: DashboardWidgetKey) => boolean,
  smartStack: SmartStackConfig | undefined,
  basePath: (string | number)[],
  ctx: z.RefinementCtx,
) {
  if (!gridLayout) return;
  const activeStackKeys = smartStack?.enabled
    ? smartStack.widgets.filter((key) => isEnabledWidget(key))
    : [];
  const stackSet = activeStackKeys.length >= 2 ? new Set(activeStackKeys) : null;

  for (const orientation of ["landscape", "portrait"] as const) {
    const { columns, rows } = gridDimensions[orientation];
    const items = gridLayout[orientation];
    const seen = new Set<DashboardWidgetKey>();
    const stackAnchor = stackSet
      ? items.find((item) => item.widgetId === activeStackKeys[0])
      : undefined;
    const effectiveItem = (item: DashboardGridItem) =>
      stackSet && stackSet.has(item.widgetId) && stackAnchor
        ? { ...stackAnchor, widgetId: item.widgetId }
        : item;
    if (stackAnchor) {
      const minWidth = Math.max(...activeStackKeys.map((key) => gridWidgetCatalog[key].minWidth));
      const minHeight = Math.max(...activeStackKeys.map((key) => gridWidgetCatalog[key].minHeight));
      if (stackAnchor.w < minWidth || stackAnchor.h < minHeight) {
        ctx.addIssue({
          code: "custom",
          message: "A âncora do Smart Stack é menor que o tamanho mínimo dos widgets",
          path: [...basePath, orientation, items.indexOf(stackAnchor)],
        });
      }
    }
    items.forEach((item, index) => {
      const path = [...basePath, orientation, index];
      if (seen.has(item.widgetId))
        ctx.addIssue({ code: "custom", message: "Posição duplicada", path });
      seen.add(item.widgetId);
      if (item.x + item.w > columns || item.y + item.h > rows)
        ctx.addIssue({ code: "custom", message: "Widget fora da grade", path });
      const minimum = gridWidgetCatalog[item.widgetId];
      if (item.w < minimum.minWidth || item.h < minimum.minHeight)
        ctx.addIssue({
          code: "custom",
          message: "Widget menor que o tamanho mínimo",
          path,
        });
      if (
        gridLayout.enabled &&
        isEnabledWidget(item.widgetId) &&
        items.slice(0, index).some((other) => {
          if (!isEnabledWidget(other.widgetId)) return false;
          // Widgets stacked together share the same Smart Stack slot.
          if (stackSet && stackSet.has(item.widgetId) && stackSet.has(other.widgetId)) {
            return false;
          }
          return gridItemsOverlap(effectiveItem(item), effectiveItem(other));
        })
      ) {
        ctx.addIssue({ code: "custom", message: "Widgets sobrepostos", path });
      }
    });
    // A grid that is in use must position every enabled widget: the player
    // would otherwise auto-place it and could overlap explicit positions.
    if (gridLayout.enabled) {
      for (const key of dashboardWidgetKeys) {
        if (!isEnabledWidget(key) || seen.has(key)) continue;
        ctx.addIssue({
          code: "custom",
          message: `Widget ativado sem posição na grade de ${orientation}`,
          path: [...basePath, orientation],
        });
      }
    }
  }
}

/** Published online configuration contains IDs, never physical paths or credentials. */
export const onlineDashboardSchema = z
  .object({
    layout: z.literal("photo-dashboard").default("photo-dashboard"),
    orientation: z.enum(["landscape", "portrait"]).default("landscape"),
    timezone: validTimezoneSchema.default("America/Sao_Paulo"),
    theme: z.enum(["light", "dark"]).default("light"),
    refreshSeconds: interval(10, 15),
    appearance: z
      .object({
        backgroundColor: color.default("#E8EEF5"),
        accentColor: color.default("#2563EB"),
        textColor: color.default("#172033"),
        ...scopedAppearanceFields,
      })
      .strict()
      .prefault({}),
    layoutOptions: dashboardLayoutOptionsSchema.prefault({}),
    widgets: z
      .object({
        photos: z
          .object({
            enabled: z.boolean().default(true),
            backgroundColor: widgetBackground,
            appearance: widgetAppearanceOverrideSchema.optional(),
            intervalSeconds: interval(5, 15),
            fit: z.enum(["cover", "contain"]).default("cover"),
            photoIds: z
              .array(z.string().regex(/^[A-Za-z0-9_-]{1,128}$/))
              .max(100)
              .refine((ids) => new Set(ids).size === ids.length, "Fotos duplicadas")
              .default([]),
          })
          .strict()
          .prefault({}),
        clock: z
          .object({
            enabled: z.boolean().default(true),
            backgroundColor: widgetBackground,
            cardSize: widgetCardSize,
            appearance: widgetAppearanceOverrideSchema.optional(),
            format: z.enum(["12h", "24h"]).default("24h"),
            // Accept the legacy flag, but never let older editors re-enable the date.
            showDate: z
              .boolean()
              .default(false)
              .transform((): boolean => false),
            size: z.enum(["small", "normal", "large"]).default("normal"),
            color: z.union([z.literal(""), color]).default(""),
          })
          .strict()
          .prefault({}),
        weather: z
          .object({
            enabled: z.boolean().default(true),
            backgroundColor: widgetBackground,
            cardSize: widgetCardSize,
            appearance: widgetAppearanceOverrideSchema.optional(),
            city: z.string().trim().min(1).max(80).default("Camboriú"),
          })
          .strict()
          .prefault({}),
        currencies: onlineCurrenciesSchema.prefault({}),
        calendar: z
          .object({
            enabled: z.boolean().default(true),
            backgroundColor: widgetBackground,
            cardSize: widgetCardSize,
            appearance: widgetAppearanceOverrideSchema.optional(),
            highlightToday: z.boolean().default(true),
          })
          .strict()
          .prefault({}),
        notes: z
          .object({
            enabled: z.boolean().default(false),
            backgroundColor: widgetBackground,
            appearance: widgetAppearanceOverrideSchema.optional(),
            title: z.string().trim().min(1).max(80).default("Recados"),
            messages: z
              .array(
                z
                  .object({
                    id: z.string().min(1).max(128),
                    text: z.string().trim().min(1).max(500),
                  })
                  .strict(),
              )
              .max(20)
              .default([]),
            intervalSeconds: interval(5, 15),
          })
          .strict()
          .prefault({}),
        countdown: z
          .object({
            enabled: z.boolean().default(false),
            backgroundColor: widgetBackground,
            appearance: widgetAppearanceOverrideSchema.optional(),
            title: z.string().trim().min(1).max(80).default("Contagem regressiva"),
            target: z
              .discriminatedUnion("kind", [
                z.object({ kind: z.literal("date"), date: z.iso.date() }).strict(),
                z
                  .object({
                    kind: z.literal("datetime"),
                    dateTime: z.iso.datetime({ offset: true }),
                  })
                  .strict(),
              ])
              .default({ kind: "date", date: "2030-01-01" }),
            display: z.enum(["days", "detailed"]).default("days"),
            completedText: z.string().trim().min(1).max(100).default("Chegou o dia!"),
          })
          .strict()
          .prefault({}),
        birthdays: z
          .object({
            enabled: z.boolean().default(false),
            backgroundColor: widgetBackground,
            appearance: widgetAppearanceOverrideSchema.optional(),
            title: z.string().trim().min(1).max(80).default("Aniversários"),
            people: z
              .array(
                z
                  .object({
                    id: z.string().min(1).max(128),
                    name: z.string().trim().min(1).max(80),
                    day: z.number().int().min(1).max(31),
                    month: z.number().int().min(1).max(12),
                  })
                  .strict()
                  .refine(
                    ({ day, month }) => day <= new Date(Date.UTC(2000, month, 0)).getUTCDate(),
                    "Data inválida",
                  ),
              )
              .max(50)
              .default([]),
            displayCount: z.number().int().min(1).max(10).default(3),
          })
          .strict()
          .prefault({}),
        tasks: z
          .object({
            enabled: z.boolean().default(false),
            backgroundColor: widgetBackground,
            appearance: widgetAppearanceOverrideSchema.optional(),
            title: z.string().trim().min(1).max(80).default("Tarefas"),
            items: z
              .array(
                z
                  .object({
                    id: z.string().min(1).max(128),
                    text: z.string().trim().min(1).max(200),
                    completed: z.boolean(),
                  })
                  .strict(),
              )
              .max(50)
              .default([]),
            showCompleted: z.boolean().default(false),
            interactive: z.boolean().default(true),
          })
          .strict()
          .prefault({}),
        pomodoro: z
          .object({
            enabled: z.boolean().default(false),
            backgroundColor: widgetBackground,
            appearance: widgetAppearanceOverrideSchema.optional(),
            title: z.string().trim().min(1).max(80).default("Pomodoro"),
            workMinutes: z.number().int().min(1).max(180).default(25),
            breakMinutes: z.number().int().min(1).max(60).default(5),
          })
          .strict()
          .prefault({}),
        system: z
          .object({
            enabled: z.boolean().default(false),
            backgroundColor: widgetBackground,
            appearance: widgetAppearanceOverrideSchema.optional(),
            title: z.string().trim().min(1).max(80).default("Monitor do sistema"),
            showCpu: z.boolean().default(true),
            showMemory: z.boolean().default(true),
            showDisk: z.boolean().default(true),
            showUptime: z.boolean().default(true),
          })
          .strict()
          .prefault({}),
        worldClock: z
          .object({
            enabled: z.boolean().default(false),
            backgroundColor: widgetBackground,
            appearance: widgetAppearanceOverrideSchema.optional(),
            title: z.string().trim().min(1).max(80).default("Relógio mundial"),
            format: z.enum(["12h", "24h"]).default("24h"),
            zones: z
              .array(worldClockZoneSchema)
              .min(1)
              .max(6)
              .refine(
                (items) => new Set(items.map((item) => item.id)).size === items.length,
                "Fusos horários duplicados",
              )
              .default(defaultWorldClockZones),
          })
          .strict()
          .prefault({}),
        rss: z
          .object({
            enabled: z.boolean().default(false),
            backgroundColor: widgetBackground,
            appearance: widgetAppearanceOverrideSchema.optional(),
            title: z.string().trim().min(1).max(80).default("Notícias RSS"),
            feedUrl: z
              .union([
                z.literal(""),
                z
                  .string()
                  .trim()
                  .max(500)
                  .refine(isSafePublicHttpsUrl, "Use uma URL HTTPS pública válida"),
              ])
              .default(""),
            maxItems: z.number().int().min(1).max(10).default(5),
            rotateSeconds: z
              .number()
              .int()
              .min(0)
              .max(3600)
              .refine((value) => value === 0 || value >= 5, "Use 0 (fixo) ou pelo menos 5 segundos")
              .default(15),
          })
          .strict()
          .prefault({}),
        devMonitor: z
          .object({
            enabled: z.boolean().default(false),
            backgroundColor: widgetBackground,
            appearance: widgetAppearanceOverrideSchema.optional(),
            title: z.string().trim().min(1).max(80).default("Status Dev & IA"),
            showServerMetrics: z.boolean().default(true),
            items: z
              .array(devMonitorItemSchema)
              .max(12)
              .refine(
                (items) => new Set(items.map((item) => item.id)).size === items.length,
                "Itens duplicados no monitor",
              )
              .default([]),
          })
          .strict()
          .prefault({}),
      })
      .strict()
      .prefault({}),
    gridLayout: dashboardGridLayoutSchema.optional(),
    smartStack: smartStackSchema.optional(),
    pages: z.array(dashboardPageSchema).min(1).max(8).optional(),
    pageSettings: pageSettingsSchema.optional(),
  })
  .strict()
  .superRefine((dashboard, ctx) => {
    validateGridLayoutForScope(
      dashboard.gridLayout,
      (key) => dashboard.widgets[key].enabled,
      dashboard.smartStack,
      ["gridLayout"],
      ctx,
    );
    const rootActiveStack = dashboard.smartStack?.enabled
      ? dashboard.smartStack.widgets.filter((key) => dashboard.widgets[key].enabled)
      : [];
    if (rootActiveStack.length >= 2 && !(dashboard.gridLayout && dashboard.gridLayout.enabled)) {
      ctx.addIssue({
        code: "custom",
        message: "Smart Stack requer grade livre ativada",
        path: dashboard.gridLayout ? ["gridLayout", "enabled"] : ["smartStack", "enabled"],
      });
    }
    if (!dashboard.pages) return;
    const seenPageIds = new Set<string>();
    dashboard.pages.forEach((page, pageIndex) => {
      if (seenPageIds.has(page.id)) {
        ctx.addIssue({
          code: "custom",
          message: "ID de página duplicado",
          path: ["pages", pageIndex, "id"],
        });
      }
      seenPageIds.add(page.id);
      const enabledSet = new Set(page.enabledWidgets);
      const effectiveGrid = page.gridLayout ?? dashboard.gridLayout;
      const effectiveStack = page.smartStack ?? dashboard.smartStack;
      validateGridLayoutForScope(
        effectiveGrid,
        (key) => enabledSet.has(key),
        effectiveStack,
        ["pages", pageIndex, "gridLayout"],
        ctx,
      );
      const activeStack = effectiveStack?.enabled
        ? effectiveStack.widgets.filter((key) => enabledSet.has(key))
        : [];
      if (activeStack.length >= 2 && !(effectiveGrid && effectiveGrid.enabled)) {
        ctx.addIssue({
          code: "custom",
          message: "Smart Stack requer grade livre ativada",
          path: page.gridLayout
            ? ["pages", pageIndex, "gridLayout", "enabled"]
            : ["pages", pageIndex, page.smartStack ? "smartStack" : "gridLayout"],
        });
      }
    });
  });

export type OnlineDashboard = z.infer<typeof onlineDashboardSchema>;
export const defaultOnlineDashboard: OnlineDashboard = onlineDashboardSchema.parse({});

export type OnlineDashboardState = {
  deviceId: string;
  config: OnlineDashboard;
  draftRevision: number;
  publishedRevision: string | null;
  appliedRevision: string | null;
  lastSeenAt: Date | string | null;
};
