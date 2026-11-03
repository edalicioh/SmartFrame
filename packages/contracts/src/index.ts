import { z } from "zod";
import { photoFrameSchema, widgetDataSchema } from "./photo-frame";
export { photoFrameSchema, defaultPhotoFrame } from "./photo-frame";
export type { PhotoFrame } from "./photo-frame";
export { widgetDataSchema, defaultWidgetSettings } from "./photo-frame";
export type { WidgetData } from "./photo-frame";
export { onlineDashboardSchema, defaultOnlineDashboard } from "./online-dashboard";
export type { OnlineDashboard, OnlineDashboardState } from "./online-dashboard";

export const carouselSchema = z
  .object({
    intervalSeconds: z.number().int().min(5).max(3600),
    order: z.enum(["sequential", "random"]),
    fit: z.enum(["cover", "contain"]),
    transition: z.enum(["none", "fade"]),
  })
  .strict();

const bounds = {
  id: z.string().min(1).max(128),
  x: z.number().nonnegative(),
  y: z.number().nonnegative(),
  width: z.number().positive(),
  height: z.number().positive(),
  zIndex: z.number().int().min(0).max(1000),
  schemaVersion: z.literal(1),
};

export const widgetSchema = z.discriminatedUnion("type", [
  z.object({ ...bounds, type: z.literal("photos"), properties: carouselSchema }).strict(),
  z
    .object({
      ...bounds,
      type: z.literal("clock"),
      properties: z.object({ hourFormat: z.enum(["12", "24"]), showDate: z.boolean() }).strict(),
    })
    .strict(),
]);

export const manifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    revision: z.string().min(1).max(128),
    deviceId: z.string().min(1).max(128),
    generatedAt: z.iso.datetime(),
    timezone: z.string().refine((value) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: value });
        return true;
      } catch {
        return false;
      }
    }, "Fuso horário inválido"),
    layout: z
      .object({
        width: z.number().int().min(1).max(8192),
        height: z.number().int().min(1).max(8192),
        mode: z.enum(["photo", "hybrid", "dashboard"]),
        theme: z.enum(["light", "dark"]),
        widgets: z.array(widgetSchema).max(32),
        photoFrame: photoFrameSchema.optional(),
      })
      .strict(),
    media: z
      .array(
        z
          .object({
            id: z.string().min(1).max(128),
            bytes: z
              .number()
              .int()
              .positive()
              .max(20 * 1024 * 1024),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
            // O player deve baixar apenas da própria API, nunca de URLs externas.
            path: z.string().regex(/^\/api\/player\/media\/[A-Za-z0-9_-]+$/),
          })
          .strict(),
      )
      .max(10000),
    sync: z
      .object({
        pollIntervalSeconds: z.number().int().min(15).max(3600),
        cacheLimitBytes: z
          .number()
          .int()
          .min(64 * 1024 * 1024)
          .max(16 * 1024 ** 3),
      })
      .strict(),
    widgetData: widgetDataSchema.optional(),
  })
  .strict()
  .superRefine((manifest, ctx) => {
    const mediaIds = manifest.media.map((media) => media.id);
    const widgetIds = manifest.layout.widgets.map((widget) => widget.id);
    if (new Set(mediaIds).size !== mediaIds.length)
      ctx.addIssue({ code: "custom", message: "Mídias duplicadas", path: ["media"] });
    if (new Set(widgetIds).size !== widgetIds.length)
      ctx.addIssue({ code: "custom", message: "Widgets duplicados", path: ["layout", "widgets"] });
    manifest.layout.widgets.forEach((widget, index) => {
      if (
        widget.x + widget.width > manifest.layout.width ||
        widget.y + widget.height > manifest.layout.height
      ) {
        ctx.addIssue({
          code: "custom",
          message: "Widget fora da área do layout",
          path: ["layout", "widgets", index],
        });
      }
    });
  });

export type PlayerManifest = z.infer<typeof manifestSchema>;
export type Widget = z.infer<typeof widgetSchema>;
