import { z } from "zod";
import { currencyPairSchema } from "./currencies";
import {
  defaultOnlineDashboard,
  onlineDashboardSchema,
  type OnlineDashboard,
} from "./online-dashboard";
import { widgetBackground, widgetCardSize } from "./widget-style";

/** The grid contract is separate from the deployed photo-dashboard contract. */
const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const title = z.string().trim().min(1).max(80);
const background = z.object({ backgroundColor: widgetBackground }).strict();
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
} as const;

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

export function gridItemsOverlap(a: GridItem, b: GridItem): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

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
    const { enabled, backgroundColor, ...settings } = source.widgets[type];
    return { id: `legacy-${type}`, type, enabled, appearance: { backgroundColor }, settings };
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
