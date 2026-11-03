import { z } from "zod";

const color = z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
const interval = (min: number, fallback: number) =>
  z.number().int().min(min).max(3600).default(fallback);

/** Published online configuration contains IDs, never physical paths or credentials. */
export const onlineDashboardSchema = z
  .object({
    layout: z.literal("photo-dashboard").default("photo-dashboard"),
    orientation: z.enum(["landscape", "portrait"]).default("landscape"),
    timezone: z
      .string()
      .max(80)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat("pt-BR", { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }, "Fuso horário inválido")
      .default("America/Sao_Paulo"),
    theme: z.enum(["light", "dark"]).default("light"),
    refreshSeconds: interval(10, 15),
    appearance: z
      .object({
        backgroundColor: color.default("#E8EEF5"),
        accentColor: color.default("#2563EB"),
        textColor: color.default("#172033"),
      })
      .strict()
      .prefault({}),
    layoutOptions: z
      .object({
        photoPosition: z.enum(["left", "right"]).default("left"),
        photoWidthPercent: z.number().int().min(40).max(75).default(62),
      })
      .strict()
      .prefault({}),
    widgets: z
      .object({
        photos: z
          .object({
            enabled: z.boolean().default(true),
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
            city: z.string().trim().min(1).max(80).default("Camboriú"),
          })
          .strict()
          .prefault({}),
        currencies: z
          .object({
            enabled: z.boolean().default(true),
            symbols: z
              .array(z.enum(["USD", "EUR", "BTC"]))
              .min(1)
              .max(3)
              .refine((symbols) => new Set(symbols).size === symbols.length)
              .default(["USD", "EUR", "BTC"]),
            intervalSeconds: interval(5, 10),
          })
          .strict()
          .prefault({}),
        calendar: z
          .object({
            enabled: z.boolean().default(true),
            highlightToday: z.boolean().default(true),
          })
          .strict()
          .prefault({}),
      })
      .strict()
      .prefault({}),
  })
  .strict();

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
