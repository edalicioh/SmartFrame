import { z } from "zod";

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const defaultWidgetSettings = {
  position: "top-left" as const,
  weather: { enabled: false, city: "São Paulo", latitude: -23.5505, longitude: -46.6333 },
  currencies: { enabled: false },
};
const widgetSettingsSchema = z
  .object({
    position: z.enum(["top-left", "top-right", "bottom-left", "bottom-right"]),
    weather: z
      .object({
        enabled: z.boolean(),
        city: z.string().trim().min(1).max(100),
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
      })
      .strict(),
    currencies: z.object({ enabled: z.boolean() }).strict(),
  })
  .strict();

export const widgetDataSchema = z
  .object({
    weather: z
      .object({
        temperature: z.number().min(-100).max(100),
        minimum: z.number().min(-100).max(100),
        maximum: z.number().min(-100).max(100),
        weatherCode: z.number().int().min(0).max(99),
        updatedAt: z.iso.datetime(),
        stale: z.boolean(),
      })
      .strict()
      .nullable(),
    currencies: z
      .object({
        usdBrl: z.number().positive().nullable(),
        eurBrl: z.number().positive().nullable(),
        btcUsd: z.number().positive().nullable(),
        fiatDate: z.string().max(30).nullable(),
        fiatUpdatedAt: z.iso.datetime().nullable(),
        btcUpdatedAt: z.iso.datetime().nullable(),
        stale: z.boolean(),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type WidgetData = z.infer<typeof widgetDataSchema>;
export const photoFrameSchema = z
  .object({
    schemaVersion: z.literal(1),
    orientation: z.enum(["landscape", "portrait"]),
    timezone: z
      .string()
      .max(100)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat("pt-BR", { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }, "Fuso horário inválido"),
    background: z
      .object({
        color,
        gradient: z.boolean(),
        photoId: z
          .string()
          .regex(/^[A-Za-z0-9_-]{1,128}$/)
          .nullable(),
        fit: z.enum(["cover", "contain"]),
        shade: z.number().min(0).max(0.85),
      })
      .strict(),
    clock: z
      .object({
        enabled: z.boolean(),
        showDate: z.boolean(),
        hourFormat: z.enum(["12", "24"]),
        position: z.enum(["top-left", "top-right", "bottom-left", "bottom-right", "center"]),
        fontSize: z.number().int().min(32).max(128),
        color,
        font: z.enum(["system", "serif"]),
      })
      .strict(),
    caption: z.string().max(120),
    widgets: widgetSettingsSchema.default(defaultWidgetSettings),
  })
  .strict();

export type PhotoFrame = z.infer<typeof photoFrameSchema>;
export const defaultPhotoFrame: PhotoFrame = {
  schemaVersion: 1,
  orientation: "landscape",
  timezone: "America/Sao_Paulo",
  background: { color: "#233e31", gradient: true, photoId: null, fit: "cover", shade: 0.2 },
  clock: {
    enabled: true,
    showDate: true,
    hourFormat: "24",
    position: "bottom-left",
    fontSize: 76,
    color: "#fffdf0",
    font: "system",
  },
  caption: "Suas memórias, sempre por perto.",
  widgets: structuredClone(defaultWidgetSettings),
};
