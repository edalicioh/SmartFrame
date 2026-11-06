import { z } from "zod";
import { onlineCurrenciesSchema } from "./currencies";
import { widgetBackground, widgetCardSize } from "./widget-style";

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
            backgroundColor: widgetBackground,
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
            highlightToday: z.boolean().default(true),
          })
          .strict()
          .prefault({}),
        notes: z
          .object({
            enabled: z.boolean().default(false),
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
          })
          .strict()
          .prefault({}),
        pomodoro: z
          .object({
            enabled: z.boolean().default(false),
            title: z.string().trim().min(1).max(80).default("Pomodoro"),
            workMinutes: z.number().int().min(1).max(180).default(25),
            breakMinutes: z.number().int().min(1).max(60).default(5),
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
