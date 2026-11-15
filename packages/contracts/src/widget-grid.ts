import { z } from "zod";
import { currencyPairSchema } from "./currencies";
import {
  dashboardGridItemSchema,
  dashboardGridLayoutSchema,
  dashboardWidgetKeys,
  defaultOnlineDashboard,
  gridDimensions,
  gridItemsOverlap,
  gridWidgetCatalog,
  onlineDashboardSchema,
  type DashboardGridItem,
  type DashboardGridLayout,
  type DashboardWidgetKey,
  type OnlineDashboard,
} from "./online-dashboard";
import {
  stripPageOnlyAppearanceFields,
  widgetAppearanceFields,
  widgetBackground,
  widgetCardSize,
  type AppearancePreset,
} from "./widget-style";

export {
  dashboardGridItemSchema,
  dashboardGridLayoutSchema,
  dashboardWidgetKeys,
  gridDimensions,
  gridItemsOverlap,
  gridWidgetCatalog,
};
export type { DashboardGridItem, DashboardGridLayout, DashboardWidgetKey };

/** The grid contract is separate from the deployed photo-dashboard contract. */
const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const title = z.string().trim().min(1).max(80);
const background = z.preprocess(
  stripPageOnlyAppearanceFields,
  z.object({ backgroundColor: widgetBackground, ...widgetAppearanceFields }).strict(),
);
const uniqueIds = <T extends { id: string }>(items: T[]) =>
  new Set(items.map((item) => item.id)).size === items.length;
const common = { id, enabled: z.boolean(), appearance: background };
const seconds = z.number().int().min(5).max(3600);
const cardSize = { cardSize: widgetCardSize };
const color = z.union([z.literal(""), z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/)]);

const photos = z
  .object({
    type: z.literal("photos"),
    ...common,
    settings: z
      .object({
        intervalSeconds: seconds,
        fit: z.enum(["cover", "contain"]),
        photoIds: z
          .array(id)
          .max(100)
          .refine((ids) => new Set(ids).size === ids.length),
      })
      .strict(),
  })
  .strict();
const clock = z
  .object({
    type: z.literal("clock"),
    ...common,
    settings: z
      .object({
        ...cardSize,
        format: z.enum(["12h", "24h"]),
        showDate: z.literal(false),
        size: z.enum(["small", "normal", "large"]),
        color,
      })
      .strict(),
  })
  .strict();
const weather = z
  .object({
    type: z.literal("weather"),
    ...common,
    settings: z.object({ ...cardSize, city: z.string().trim().min(1).max(80) }).strict(),
  })
  .strict();
const currencies = z
  .object({
    type: z.literal("currencies"),
    ...common,
    settings: z
      .object({
        ...cardSize,
        pairs: z
          .array(currencyPairSchema)
          .min(1)
          .max(20)
          .refine((pairs) => new Set(pairs).size === pairs.length),
        displayCount: z.number().int().min(1).max(4),
        intervalSeconds: seconds,
      })
      .strict(),
  })
  .strict();
const calendar = z
  .object({
    type: z.literal("calendar"),
    ...common,
    settings: z.object({ ...cardSize, highlightToday: z.boolean() }).strict(),
  })
  .strict();

const message = z.object({ id, text: z.string().trim().min(1).max(500) }).strict();
const birthday = z
  .object({
    id,
    name: title,
    day: z.number().int().min(1).max(31),
    month: z.number().int().min(1).max(12),
    year: z.number().int().min(1900).max(9999).optional(),
  })
  .strict()
  .refine(
    ({ day, month, year }) => day <= new Date(Date.UTC(year ?? 2000, month, 0)).getUTCDate(),
    "Data inválida",
  );
const task = z
  .object({ id, text: z.string().trim().min(1).max(200), completed: z.boolean() })
  .strict();
const notes = z
  .object({
    type: z.literal("notes"),
    ...common,
    settings: z
      .object({
        title,
        messages: z.array(message).max(20).refine(uniqueIds),
        intervalSeconds: seconds,
      })
      .strict(),
  })
  .strict();
const countdown = z
  .object({
    type: z.literal("countdown"),
    ...common,
    settings: z
      .object({
        title,
        target: z.discriminatedUnion("kind", [
          z.object({ kind: z.literal("date"), date: z.iso.date() }).strict(),
          z
            .object({ kind: z.literal("datetime"), dateTime: z.iso.datetime({ offset: true }) })
            .strict(),
        ]),
        display: z.enum(["days", "detailed"]),
        completedText: z.string().trim().min(1).max(100),
      })
      .strict(),
  })
  .strict();
const birthdays = z
  .object({
    type: z.literal("birthdays"),
    ...common,
    settings: z
      .object({
        title,
        people: z.array(birthday).max(50).refine(uniqueIds),
        displayCount: z.number().int().min(1).max(10),
      })
      .strict(),
  })
  .strict();
const tasks = z
  .object({
    type: z.literal("tasks"),
    ...common,
    settings: z
      .object({ title, items: z.array(task).max(50).refine(uniqueIds), showCompleted: z.boolean() })
      .strict(),
  })
  .strict();

export const gridWidgetSchema = z.discriminatedUnion("type", [
  photos,
  clock,
  weather,
  currencies,
  calendar,
  notes,
  countdown,
  birthdays,
  tasks,
]);

const itemSchema = z
  .object({
    widgetId: id,
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
    w: z.number().int().positive(),
    h: z.number().int().positive(),
  })
  .strict();

export type GridItem = z.infer<typeof itemSchema>;

const gridSchema = z.object({ items: z.array(itemSchema).max(24) }).strict();
const timezone = onlineDashboardSchema.shape.timezone;
const appearance = onlineDashboardSchema.shape.appearance;

export const widgetGridDashboardSchema = z
  .object({
    schemaVersion: z.literal(2),
    layout: z.literal("widget-grid"),
    orientation: z.enum(["landscape", "portrait"]),
    timezone,
    theme: z.enum(["light", "dark"]),
    refreshSeconds: z.number().int().min(10).max(3600),
    appearance,
    widgets: z.array(gridWidgetSchema).max(24).refine(uniqueIds, "IDs de widgets duplicados"),
    layouts: z.object({ landscape: gridSchema, portrait: gridSchema }).strict(),
  })
  .strict()
  .superRefine((dashboard, ctx) => {
    const widgets = new Map(dashboard.widgets.map((widget) => [widget.id, widget]));
    const photoIds = new Set(
      dashboard.widgets.flatMap((widget) =>
        widget.type === "photos" ? widget.settings.photoIds : [],
      ),
    );
    if (photoIds.size > 100)
      ctx.addIssue({
        code: "custom",
        message: "Máximo de 100 fotos distintas por painel",
        path: ["widgets"],
      });
    for (const orientation of ["landscape", "portrait"] as const) {
      const { columns, rows } = gridDimensions[orientation];
      const items = dashboard.layouts[orientation].items;
      const seen = new Set<string>();
      items.forEach((item, index) => {
        const path = ["layouts", orientation, "items", index];
        if (!widgets.has(item.widgetId))
          ctx.addIssue({ code: "custom", message: "Widget não encontrado", path });
        if (seen.has(item.widgetId))
          ctx.addIssue({ code: "custom", message: "Posição duplicada", path });
        seen.add(item.widgetId);
        if (item.x + item.w > columns || item.y + item.h > rows)
          ctx.addIssue({ code: "custom", message: "Widget fora da grade", path });
        const widget = widgets.get(item.widgetId);
        if (widget) {
          const minimum = gridWidgetCatalog[widget.type];
          if (item.w < minimum.minWidth || item.h < minimum.minHeight)
            ctx.addIssue({ code: "custom", message: "Widget menor que o tamanho mínimo", path });
        }
        if (
          widgets.get(item.widgetId)?.enabled &&
          items
            .slice(0, index)
            .some((other) => widgets.get(other.widgetId)?.enabled && gridItemsOverlap(item, other))
        )
          ctx.addIssue({ code: "custom", message: "Widgets sobrepostos", path });
      });
      for (const widget of dashboard.widgets) {
        if (!seen.has(widget.id))
          ctx.addIssue({
            code: "custom",
            message: "Widget sem posição",
            path: ["layouts", orientation, "items"],
          });
      }
    }
  });

export type GridWidget = z.infer<typeof gridWidgetSchema>;
export type WidgetGridDashboard = z.infer<typeof widgetGridDashboardSchema>;

/** Construct one validated instance. Countdown dates are supplied by the caller. */
export function createGridWidget(
  type: GridWidget["type"],
  widgetId: string,
  today: string,
): GridWidget {
  const legacy = convertOnlineDashboardToGrid(defaultOnlineDashboard).widgets.find(
    (widget) => widget.type === type,
  );
  if (legacy) return gridWidgetSchema.parse({ ...legacy, id: widgetId });
  const common = { id: widgetId, enabled: true, appearance: { backgroundColor: "" } };
  switch (type) {
    case "notes":
      return gridWidgetSchema.parse({
        ...common,
        type,
        settings: { title: "Recados", messages: [], intervalSeconds: 15 },
      });
    case "countdown":
      return gridWidgetSchema.parse({
        ...common,
        type,
        settings: {
          title: "Contagem regressiva",
          target: { kind: "date", date: today },
          display: "days",
          completedText: "Chegou o dia!",
        },
      });
    case "birthdays":
      return gridWidgetSchema.parse({
        ...common,
        type,
        settings: { title: "Aniversários", people: [], displayCount: 3 },
      });
    case "tasks":
      return gridWidgetSchema.parse({
        ...common,
        type,
        settings: { title: "Tarefas", items: [], showCompleted: false },
      });
    default:
      throw new Error("Tipo de widget desconhecido");
  }
}

/** Read without converting or mutating published configurations. */
export function readOnlineDashboard(
  input: unknown,
): { version: 1; config: OnlineDashboard } | { version: 2; config: WidgetGridDashboard } {
  const hasVersion =
    input !== null &&
    typeof input === "object" &&
    Object.prototype.hasOwnProperty.call(input, "schemaVersion");
  return hasVersion
    ? { version: 2, config: widgetGridDashboardSchema.parse(input) }
    : { version: 1, config: onlineDashboardSchema.parse(input) };
}

/** Union media references across all photo instances, including disabled ones. */
export function dashboardPhotoIds(config: OnlineDashboard | WidgetGridDashboard): string[] {
  if (config.layout === "photo-dashboard") return [...config.widgets.photos.photoIds];
  return [
    ...new Set(
      config.widgets.flatMap((widget) =>
        widget.type === "photos" ? widget.settings.photoIds : [],
      ),
    ),
  ];
}

/** Find the first legal slot, without moving any existing widget. */
export function findGridPosition(
  orientation: keyof typeof gridDimensions,
  widgetId: string,
  width: number,
  height: number,
  occupied: readonly GridItem[],
): GridItem | null {
  const { columns, rows } = gridDimensions[orientation];
  if (
    !id.safeParse(widgetId).success ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > columns ||
    height > rows
  )
    return null;
  for (let y = 0; y <= rows - height; y++) {
    for (let x = 0; x <= columns - width; x++) {
      const item = { widgetId, x, y, w: width, h: height };
      if (!occupied.some((other) => gridItemsOverlap(item, other))) return item;
    }
  }
  return null;
}

/** Pure, deterministic conversion. It never writes a draft or a published version. */
export function convertOnlineDashboardToGrid(input: unknown): WidgetGridDashboard {
  const source: OnlineDashboard = onlineDashboardSchema.parse(input);
  const names = ["photos", "clock", "weather", "currencies", "calendar"] as const;
  const widgets = names.map((type) => {
    const {
      enabled,
      backgroundColor,
      appearance: widgetAppearance,
      ...settings
    } = source.widgets[type];
    return {
      id: `legacy-${type}`,
      type,
      enabled,
      appearance: { ...(widgetAppearance ?? {}), backgroundColor },
      settings,
    };
  });
  const photoWidth = Math.round((source.layoutOptions.photoWidthPercent * 24) / 100);
  const right = source.layoutOptions.photoPosition === "right";
  const heights = [4, 4, 5, 11];
  let top = 0;
  const landscape = [
    { widgetId: "legacy-photos", x: right ? 24 - photoWidth : 0, y: 0, w: photoWidth, h: 24 },
    ...names.slice(1).map((type, index) => {
      const item = {
        widgetId: `legacy-${type}`,
        x: right ? 0 : photoWidth,
        y: top,
        w: 24 - photoWidth,
        h: heights[index],
      };
      top += item.h;
      return item;
    }),
  ];
  const portraitHeights = [4, 4, 4, 10];
  top = 18;
  const portrait = [
    { widgetId: "legacy-photos", x: 0, y: 0, w: 12, h: 18 },
    ...names.slice(1).map((type, index) => {
      const item = { widgetId: `legacy-${type}`, x: 0, y: top, w: 12, h: portraitHeights[index] };
      top += item.h;
      return item;
    }),
  ];
  return widgetGridDashboardSchema.parse({
    schemaVersion: 2,
    layout: "widget-grid",
    orientation: source.orientation,
    timezone: source.timezone,
    theme: source.theme,
    refreshSeconds: source.refreshSeconds,
    appearance: source.appearance,
    widgets,
    layouts: { landscape: { items: landscape }, portrait: { items: portrait } },
  });
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

/** Generate a valid, non-overlapping default grid layout covering all 10 widgets. */
export function createDefaultDashboardGridLayout(
  config: OnlineDashboard = defaultOnlineDashboard,
): DashboardGridLayout {
  const photoWidth = clampInt((config.layoutOptions.photoWidthPercent * 24) / 100, 10, 18);
  const sideWidth = 24 - photoWidth;
  const right = config.layoutOptions.photoPosition === "right";
  const photoX = right ? sideWidth : 0;
  const sideX = right ? 0 : photoWidth;
  const w1 = Math.floor(photoWidth / 3);
  const w2 = Math.floor(photoWidth / 3);
  const w3 = photoWidth - w1 - w2;

  return {
    enabled: config.gridLayout?.enabled ?? false,
    landscape: [
      { widgetId: "photos", x: photoX, y: 0, w: photoWidth, h: 18 },
      { widgetId: "clock", x: sideX, y: 0, w: sideWidth, h: 4 },
      { widgetId: "weather", x: sideX, y: 4, w: sideWidth, h: 5 },
      { widgetId: "currencies", x: sideX, y: 9, w: sideWidth, h: 5 },
      { widgetId: "calendar", x: sideX, y: 14, w: sideWidth, h: 10 },
      { widgetId: "notes", x: photoX, y: 18, w: w1, h: 3 },
      { widgetId: "countdown", x: photoX + w1, y: 18, w: w2, h: 3 },
      { widgetId: "birthdays", x: photoX + w1 + w2, y: 18, w: w3, h: 3 },
      { widgetId: "tasks", x: photoX, y: 21, w: w1 + w2, h: 3 },
      { widgetId: "pomodoro", x: photoX + w1 + w2, y: 21, w: w3, h: 3 },
    ],
    portrait: [
      { widgetId: "photos", x: 0, y: 0, w: 12, h: 18 },
      { widgetId: "clock", x: 0, y: 18, w: 6, h: 4 },
      { widgetId: "weather", x: 6, y: 18, w: 6, h: 4 },
      { widgetId: "currencies", x: 0, y: 22, w: 6, h: 5 },
      { widgetId: "calendar", x: 6, y: 22, w: 6, h: 8 },
      { widgetId: "notes", x: 0, y: 27, w: 6, h: 3 },
      { widgetId: "tasks", x: 0, y: 30, w: 6, h: 5 },
      { widgetId: "countdown", x: 6, y: 30, w: 6, h: 4 },
      { widgetId: "birthdays", x: 0, y: 35, w: 6, h: 5 },
      { widgetId: "pomodoro", x: 6, y: 34, w: 6, h: 6 },
    ],
  };
}

export type PanelTemplateId =
  | "classic-frame"
  | "home-dashboard"
  | "focus-desk"
  | "markets-status"
  | "ambient-minimal"
  | "seamless-wall";

export type PanelTemplate = {
  id: PanelTemplateId;
  name: string;
  description: string;
  theme: OnlineDashboard["theme"];
  appearance: {
    backgroundColor: string;
    accentColor: string;
    textColor: string;
    preset: AppearancePreset;
    cornerRadius: number;
    widgetSpacing: number;
    innerPadding: number;
    pageEdgePadding: number;
    border: boolean;
    shadow: boolean;
  };
  layoutOptions: OnlineDashboard["layoutOptions"];
  enabledWidgets: readonly DashboardWidgetKey[];
  gridLayout: DashboardGridLayout;
};

export const panelTemplates: readonly PanelTemplate[] = [
  {
    id: "classic-frame",
    name: "Porta-Retrato Clássico",
    description:
      "Foto em destaque ocupando 62% da tela com relógio, clima, moedas e agenda na lateral.",
    theme: "light",
    appearance: {
      backgroundColor: "#E8EEF5",
      accentColor: "#2563EB",
      textColor: "#172033",
      preset: "cards",
      cornerRadius: 18,
      widgetSpacing: 12,
      innerPadding: 12,
      pageEdgePadding: 12,
      border: true,
      shadow: false,
    },
    layoutOptions: { photoPosition: "left", photoWidthPercent: 62 },
    enabledWidgets: ["photos", "clock", "weather", "currencies", "calendar"],
    gridLayout: {
      enabled: true,
      landscape: [
        { widgetId: "photos", x: 0, y: 0, w: 15, h: 24 },
        { widgetId: "clock", x: 15, y: 0, w: 9, h: 4 },
        { widgetId: "weather", x: 15, y: 4, w: 9, h: 5 },
        { widgetId: "currencies", x: 15, y: 9, w: 9, h: 5 },
        { widgetId: "calendar", x: 15, y: 14, w: 9, h: 10 },
      ],
      portrait: [
        { widgetId: "photos", x: 0, y: 0, w: 12, h: 20 },
        { widgetId: "clock", x: 0, y: 20, w: 6, h: 5 },
        { widgetId: "weather", x: 6, y: 20, w: 6, h: 5 },
        { widgetId: "currencies", x: 0, y: 25, w: 12, h: 6 },
        { widgetId: "calendar", x: 0, y: 31, w: 12, h: 9 },
      ],
    },
  },
  {
    id: "home-dashboard",
    name: "Painel Familiar da Casa",
    description:
      "Visão completa com fotos, agenda, tarefas, recados, contagem regressiva e aniversários.",
    theme: "light",
    appearance: {
      backgroundColor: "#F4EFE6",
      accentColor: "#0F766E",
      textColor: "#1F2937",
      preset: "cards",
      cornerRadius: 16,
      widgetSpacing: 10,
      innerPadding: 12,
      pageEdgePadding: 12,
      border: true,
      shadow: true,
    },
    layoutOptions: { photoPosition: "left", photoWidthPercent: 45 },
    enabledWidgets: [
      "photos",
      "clock",
      "weather",
      "calendar",
      "notes",
      "countdown",
      "birthdays",
      "tasks",
    ],
    gridLayout: {
      enabled: true,
      landscape: [
        { widgetId: "photos", x: 0, y: 0, w: 10, h: 15 },
        { widgetId: "notes", x: 0, y: 15, w: 5, h: 9 },
        { widgetId: "countdown", x: 5, y: 15, w: 5, h: 9 },
        { widgetId: "clock", x: 10, y: 0, w: 7, h: 5 },
        { widgetId: "weather", x: 17, y: 0, w: 7, h: 5 },
        { widgetId: "calendar", x: 10, y: 5, w: 8, h: 11 },
        { widgetId: "birthdays", x: 18, y: 5, w: 6, h: 11 },
        { widgetId: "tasks", x: 10, y: 16, w: 14, h: 8 },
      ],
      portrait: [
        { widgetId: "clock", x: 0, y: 0, w: 6, h: 5 },
        { widgetId: "weather", x: 6, y: 0, w: 6, h: 5 },
        { widgetId: "photos", x: 0, y: 5, w: 12, h: 14 },
        { widgetId: "calendar", x: 0, y: 19, w: 7, h: 10 },
        { widgetId: "birthdays", x: 7, y: 19, w: 5, h: 10 },
        { widgetId: "tasks", x: 0, y: 29, w: 6, h: 11 },
        { widgetId: "notes", x: 6, y: 29, w: 6, h: 6 },
        { widgetId: "countdown", x: 6, y: 35, w: 6, h: 5 },
      ],
    },
  },
  {
    id: "focus-desk",
    name: "Mesa de Foco & Pomodoro",
    description: "Layout escuro de produtividade com Pomodoro, tarefas, hora, recados e fotos.",
    theme: "dark",
    appearance: {
      backgroundColor: "#0F172A",
      accentColor: "#38BDF8",
      textColor: "#F8FAFC",
      preset: "flat",
      cornerRadius: 14,
      widgetSpacing: 12,
      innerPadding: 14,
      pageEdgePadding: 14,
      border: false,
      shadow: false,
    },
    layoutOptions: { photoPosition: "left", photoWidthPercent: 40 },
    enabledWidgets: ["photos", "clock", "weather", "notes", "tasks", "pomodoro"],
    gridLayout: {
      enabled: true,
      landscape: [
        { widgetId: "pomodoro", x: 0, y: 0, w: 10, h: 13 },
        { widgetId: "photos", x: 0, y: 13, w: 10, h: 11 },
        { widgetId: "clock", x: 10, y: 0, w: 7, h: 6 },
        { widgetId: "weather", x: 17, y: 0, w: 7, h: 6 },
        { widgetId: "tasks", x: 10, y: 6, w: 14, h: 10 },
        { widgetId: "notes", x: 10, y: 16, w: 14, h: 8 },
      ],
      portrait: [
        { widgetId: "clock", x: 0, y: 0, w: 7, h: 6 },
        { widgetId: "weather", x: 7, y: 0, w: 5, h: 6 },
        { widgetId: "pomodoro", x: 0, y: 6, w: 12, h: 10 },
        { widgetId: "tasks", x: 0, y: 16, w: 12, h: 10 },
        { widgetId: "notes", x: 0, y: 26, w: 12, h: 6 },
        { widgetId: "photos", x: 0, y: 32, w: 12, h: 8 },
      ],
    },
  },
  {
    id: "markets-status",
    name: "Cotações & Agenda Executiva",
    description:
      "Ênfase em moedas, hora certa, previsão do tempo e calendário com tema escuro contrastado.",
    theme: "dark",
    appearance: {
      backgroundColor: "#0B1120",
      accentColor: "#22C55E",
      textColor: "#E2E8F0",
      preset: "cards",
      cornerRadius: 14,
      widgetSpacing: 12,
      innerPadding: 14,
      pageEdgePadding: 12,
      border: true,
      shadow: false,
    },
    layoutOptions: { photoPosition: "right", photoWidthPercent: 40 },
    enabledWidgets: ["photos", "clock", "weather", "currencies", "calendar"],
    gridLayout: {
      enabled: true,
      landscape: [
        { widgetId: "clock", x: 0, y: 0, w: 8, h: 6 },
        { widgetId: "weather", x: 8, y: 0, w: 8, h: 6 },
        { widgetId: "currencies", x: 0, y: 6, w: 16, h: 8 },
        { widgetId: "calendar", x: 0, y: 14, w: 16, h: 10 },
        { widgetId: "photos", x: 16, y: 0, w: 8, h: 24 },
      ],
      portrait: [
        { widgetId: "clock", x: 0, y: 0, w: 6, h: 6 },
        { widgetId: "weather", x: 6, y: 0, w: 6, h: 6 },
        { widgetId: "currencies", x: 0, y: 6, w: 12, h: 10 },
        { widgetId: "calendar", x: 0, y: 16, w: 12, h: 12 },
        { widgetId: "photos", x: 0, y: 28, w: 12, h: 12 },
      ],
    },
  },
  {
    id: "ambient-minimal",
    name: "Galeria Minimalista",
    description: "Fotos quase em tela cheia com apenas relógio e clima em superfície sem bordas.",
    theme: "dark",
    appearance: {
      backgroundColor: "#111827",
      accentColor: "#F59E0B",
      textColor: "#F9FAFB",
      preset: "borderless",
      cornerRadius: 0,
      widgetSpacing: 12,
      innerPadding: 12,
      pageEdgePadding: 12,
      border: false,
      shadow: false,
    },
    layoutOptions: { photoPosition: "left", photoWidthPercent: 75 },
    enabledWidgets: ["photos", "clock", "weather"],
    gridLayout: {
      enabled: true,
      landscape: [
        { widgetId: "photos", x: 0, y: 0, w: 18, h: 24 },
        { widgetId: "clock", x: 18, y: 0, w: 6, h: 12 },
        { widgetId: "weather", x: 18, y: 12, w: 6, h: 12 },
      ],
      portrait: [
        { widgetId: "photos", x: 0, y: 0, w: 12, h: 30 },
        { widgetId: "clock", x: 0, y: 30, w: 6, h: 10 },
        { widgetId: "weather", x: 6, y: 30, w: 6, h: 10 },
      ],
    },
  },
  {
    id: "seamless-wall",
    name: "Painel Contínuo Sem Bordas",
    description:
      "Modo contínuo de quiosque sem frestas nem bordas entre fotos, hora, clima e recados.",
    theme: "dark",
    appearance: {
      backgroundColor: "#090D16",
      accentColor: "#60A5FA",
      textColor: "#F1F5F9",
      preset: "seamless",
      cornerRadius: 0,
      widgetSpacing: 0,
      innerPadding: 14,
      pageEdgePadding: 0,
      border: false,
      shadow: false,
    },
    layoutOptions: { photoPosition: "left", photoWidthPercent: 62 },
    enabledWidgets: ["photos", "clock", "weather", "notes"],
    gridLayout: {
      enabled: true,
      landscape: [
        { widgetId: "photos", x: 0, y: 0, w: 15, h: 24 },
        { widgetId: "clock", x: 15, y: 0, w: 9, h: 8 },
        { widgetId: "weather", x: 15, y: 8, w: 9, h: 8 },
        { widgetId: "notes", x: 15, y: 16, w: 9, h: 8 },
      ],
      portrait: [
        { widgetId: "photos", x: 0, y: 0, w: 12, h: 22 },
        { widgetId: "clock", x: 0, y: 22, w: 6, h: 9 },
        { widgetId: "weather", x: 6, y: 22, w: 6, h: 9 },
        { widgetId: "notes", x: 0, y: 31, w: 12, h: 9 },
      ],
    },
  },
];

/** Apply one curated template without discarding user photos, calendar, notes, tasks, or lists. */
export function applyPanelTemplate(
  current: OnlineDashboard,
  templateId: PanelTemplateId,
): OnlineDashboard {
  const template = panelTemplates.find((entry) => entry.id === templateId);
  if (!template) throw new Error(`Template desconhecido: ${templateId}`);
  const enabled = new Set<DashboardWidgetKey>(template.enabledWidgets);

  return onlineDashboardSchema.parse({
    ...current,
    theme: template.theme,
    appearance: { ...template.appearance },
    layoutOptions: { ...template.layoutOptions },
    widgets: {
      photos: { ...current.widgets.photos, enabled: enabled.has("photos") },
      clock: { ...current.widgets.clock, enabled: enabled.has("clock") },
      weather: { ...current.widgets.weather, enabled: enabled.has("weather") },
      currencies: { ...current.widgets.currencies, enabled: enabled.has("currencies") },
      calendar: { ...current.widgets.calendar, enabled: enabled.has("calendar") },
      notes: { ...current.widgets.notes, enabled: enabled.has("notes") },
      countdown: { ...current.widgets.countdown, enabled: enabled.has("countdown") },
      birthdays: { ...current.widgets.birthdays, enabled: enabled.has("birthdays") },
      tasks: { ...current.widgets.tasks, enabled: enabled.has("tasks") },
      pomodoro: { ...current.widgets.pomodoro, enabled: enabled.has("pomodoro") },
    },
    gridLayout: {
      enabled: true,
      landscape: template.gridLayout.landscape.map((item) => ({ ...item })),
      portrait: template.gridLayout.portrait.map((item) => ({ ...item })),
    },
  });
}

function defaultWidgetBoxSize(
  key: DashboardWidgetKey,
  orientation: keyof typeof gridDimensions,
  config: OnlineDashboard,
): { w: number; h: number } {
  const { columns, rows } = gridDimensions[orientation];
  if (key === "photos") {
    return orientation === "landscape"
      ? { w: clampInt((config.layoutOptions.photoWidthPercent * columns) / 100, 8, 16), h: 16 }
      : { w: columns, h: 16 };
  }
  if (key === "calendar") {
    return orientation === "landscape" ? { w: 8, h: 8 } : { w: 6, h: 8 };
  }
  if (key === "pomodoro") {
    return orientation === "landscape" ? { w: 6, h: 4 } : { w: 6, h: 5 };
  }
  return orientation === "landscape"
    ? { w: Math.min(8, columns), h: Math.min(4, rows) }
    : { w: 6, h: 4 };
}

function arrangeOrientationItems(
  config: OnlineDashboard,
  orientation: keyof typeof gridDimensions,
  existingItems: readonly DashboardGridItem[],
): DashboardGridItem[] {
  const { columns, rows } = gridDimensions[orientation];
  const existingMap = new Map(existingItems.map((item) => [item.widgetId, item]));
  // Disabled widgets are hidden in the player, but their saved position must
  // survive arrangement so re-enabling them restores the customized box.
  // Invalid legacy boxes are clamped instead of dropped.
  const inactiveItems = [...existingMap.values()]
    .filter((item) => !config.widgets[item.widgetId].enabled)
    .map((item) => {
      const minimum = gridWidgetCatalog[item.widgetId];
      const w = clampInt(item.w, minimum.minWidth, columns);
      const h = clampInt(item.h, minimum.minHeight, rows);
      return {
        widgetId: item.widgetId,
        x: clampInt(item.x, 0, columns - w),
        y: clampInt(item.y, 0, rows - h),
        w,
        h,
      };
    });
  const enabledKeys = dashboardWidgetKeys.filter((key) => config.widgets[key].enabled);
  if (enabledKeys.length === 0) return inactiveItems;

  const orderedKeys = [...enabledKeys].sort((a, b) => {
    const itemA = existingMap.get(a);
    const itemB = existingMap.get(b);
    if (a === "photos" && b !== "photos") return -1;
    if (b === "photos" && a !== "photos") return 1;
    if (itemA && itemB) return itemA.y - itemB.y || itemA.x - itemB.x;
    if (itemA) return -1;
    if (itemB) return 1;
    return dashboardWidgetKeys.indexOf(a) - dashboardWidgetKeys.indexOf(b);
  });

  const placed: DashboardGridItem[] = [];
  let failedToPack = false;

  for (const key of orderedKeys) {
    const minimum = gridWidgetCatalog[key];
    const current = existingMap.get(key);
    const preferred = current
      ? {
          w: clampInt(current.w, minimum.minWidth, columns),
          h: clampInt(current.h, minimum.minHeight, rows),
        }
      : defaultWidgetBoxSize(key, orientation, config);

    if (current) {
      const x = clampInt(current.x, 0, columns - preferred.w);
      const y = clampInt(current.y, 0, rows - preferred.h);
      const candidate: DashboardGridItem = { widgetId: key, x, y, w: preferred.w, h: preferred.h };
      if (!placed.some((other) => gridItemsOverlap(candidate, other))) {
        placed.push(candidate);
        continue;
      }
    }

    const sizesToTry: Array<{ w: number; h: number }> = [
      preferred,
      {
        w: Math.max(minimum.minWidth, Math.floor(preferred.w * 0.75)),
        h: Math.max(minimum.minHeight, Math.floor(preferred.h * 0.75)),
      },
      { w: minimum.minWidth, h: preferred.h },
      { w: preferred.w, h: minimum.minHeight },
      { w: minimum.minWidth, h: minimum.minHeight },
    ];

    let found: DashboardGridItem | null = null;
    for (const size of sizesToTry) {
      const slot = findGridPosition(orientation, key, size.w, size.h, placed);
      if (slot) {
        found = { widgetId: key, x: slot.x, y: slot.y, w: slot.w, h: slot.h };
        break;
      }
    }

    if (!found) {
      failedToPack = true;
      break;
    }
    placed.push(found);
  }

  if (!failedToPack) return [...placed, ...inactiveItems];
  const fallback = createDefaultDashboardGridLayout(config)[orientation];
  return [...fallback.filter((item) => config.widgets[item.widgetId].enabled), ...inactiveItems];
}

/**
 * Auto-arrange enabled widgets on the modular grid without collisions or out-of-bounds items.
 * Stored positions of disabled widgets are kept so re-enabling them restores their box.
 * The returned dashboard is intentionally not parsed: this runs from edit handlers while other
 * draft fields can be temporarily incomplete. Save and read paths validate the whole dashboard.
 */
export function autoArrangeDashboardGrid(
  config: OnlineDashboard,
  orientation?: keyof typeof gridDimensions,
): OnlineDashboard {
  const base = config.gridLayout ?? createDefaultDashboardGridLayout(config);
  const nextGridLayout: DashboardGridLayout = {
    enabled: config.gridLayout?.enabled ?? true,
    landscape:
      !orientation || orientation === "landscape"
        ? arrangeOrientationItems(config, "landscape", base.landscape)
        : base.landscape.map((item) => ({ ...item })),
    portrait:
      !orientation || orientation === "portrait"
        ? arrangeOrientationItems(config, "portrait", base.portrait)
        : base.portrait.map((item) => ({ ...item })),
  };
  return { ...config, gridLayout: nextGridLayout };
}

function validStoredGridItems(value: unknown): DashboardGridItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const parsed = dashboardGridItemSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

/**
 * Read a stored version 1 dashboard. Configurations written before the grid
 * coverage rule could enable the grid with missing or overlapping positions;
 * those are repaired deterministically instead of failing the whole read.
 * Only a grid that is actually enabled is repaired, and everything else must
 * still satisfy the strict contract.
 */
export function readStoredOnlineDashboard(input: unknown): OnlineDashboard {
  const strict = onlineDashboardSchema.safeParse(input);
  if (strict.success) return strict.data;
  if (input === null || typeof input !== "object" || Array.isArray(input)) throw strict.error;
  const record = input as Record<string, unknown>;
  const grid = record.gridLayout;
  if (grid === null || typeof grid !== "object" || Array.isArray(grid)) throw strict.error;
  const layout = grid as Record<string, unknown>;
  if (layout.enabled !== true) throw strict.error;
  const withoutGrid = { ...record };
  delete withoutGrid.gridLayout;
  const rest = onlineDashboardSchema.safeParse(withoutGrid);
  if (!rest.success) throw strict.error;
  return onlineDashboardSchema.parse(
    autoArrangeDashboardGrid({
      ...rest.data,
      gridLayout: {
        enabled: true,
        landscape: validStoredGridItems(layout.landscape),
        portrait: validStoredGridItems(layout.portrait),
      },
    }),
  );
}
