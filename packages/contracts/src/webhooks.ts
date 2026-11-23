import { z } from "zod";
import { notificationSeveritySchema, pushKeyRegex, pushStatusSchema } from "./rules";

function stripControlChars(value: string): string {
  return value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
}

const cleanTrimmedText = (min: number, max: number) =>
  z
    .string()
    .transform((value) => stripControlChars(value).trim())
    .pipe(z.string().min(min).max(max));

const cleanOptionalTrimmedText = (max: number, min = 0) =>
  z
    .string()
    .transform((value) => stripControlChars(value).trim())
    .pipe(min > 0 ? z.string().min(min).max(max) : z.string().max(max))
    .optional();

const cleanPushValueSchema = z.union([
  z
    .string()
    .transform((value) => stripControlChars(value).trim())
    .pipe(z.string().max(120)),
  z.number().finite(),
  z.boolean(),
]);

export const webhookPermissions = ["push", "notify", "goto", "refresh"] as const;
export type WebhookPermission = (typeof webhookPermissions)[number];
export const webhookPermissionSchema = z.enum(webhookPermissions);

export const webhookKeyCreateSchema = z
  .object({
    name: cleanTrimmedText(1, 80),
    permissions: z
      .array(webhookPermissionSchema)
      .min(1)
      .max(4)
      .refine((items) => new Set(items).size === items.length, "Permissões duplicadas")
      .default([...webhookPermissions]),
  })
  .strict();

export type WebhookKeyCreateInput = z.infer<typeof webhookKeyCreateSchema>;

export const pushKeySchema = z.string().regex(pushKeyRegex, "Chave de push inválida");

export const pushPayloadSchema = z
  .object({
    name: cleanOptionalTrimmedText(60, 1),
    title: cleanOptionalTrimmedText(60, 1),
    category: z.enum(["ci", "ai", "service", "deploy"]).optional(),
    status: pushStatusSchema.optional(),
    detail: cleanOptionalTrimmedText(120),
    text: cleanOptionalTrimmedText(120),
    value: cleanPushValueSchema.optional(),
    ttlSeconds: z.number().int().min(30).max(86_400).default(86_400),
  })
  .strict()
  .refine(
    (data) =>
      data.status !== undefined ||
      data.detail !== undefined ||
      data.text !== undefined ||
      data.value !== undefined,
    "Informe ao menos um campo de valor, detalhe ou status",
  );

export type PushPayload = z.infer<typeof pushPayloadSchema>;

export const pushedFeedEntrySchema = z
  .object({
    key: pushKeySchema,
    name: cleanTrimmedText(1, 60),
    category: z.enum(["ci", "ai", "service", "deploy"]).default("service"),
    status: pushStatusSchema.default("healthy"),
    detail: z
      .string()
      .transform(stripControlChars)
      .pipe(z.string().max(120))
      .default(""),
    value: z
      .union([
        z.string().transform(stripControlChars).pipe(z.string().max(120)),
        z.number().finite(),
        z.boolean(),
        z.null(),
      ])
      .default(null),
    updatedAt: z.string(),
  })
  .strict();

export type PushedFeedEntry = z.infer<typeof pushedFeedEntrySchema>;

const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);

export const notifyPayloadSchema = z
  .object({
    title: cleanOptionalTrimmedText(80),
    message: cleanTrimmedText(1, 300),
    severity: notificationSeveritySchema.default("info"),
    durationSeconds: z.number().int().min(3).max(120).default(8),
    deviceId: idSchema.optional(),
    panelId: idSchema.optional(),
  })
  .strict();

export type NotifyPayload = z.infer<typeof notifyPayloadSchema>;

export const gotoPageParamSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,64}$/, "Identificador de página inválido");

export const gotoPayloadSchema = z
  .object({
    deviceId: idSchema.optional(),
    panelId: idSchema.optional(),
    durationSeconds: z.number().int().min(0).max(3600).default(0),
    refresh: z.boolean().default(false),
  })
  .strict();

export type GotoPayload = z.infer<typeof gotoPayloadSchema>;

export const refreshPayloadSchema = z
  .object({
    deviceId: idSchema.optional(),
    panelId: idSchema.optional(),
  })
  .strict();

export type RefreshPayload = z.infer<typeof refreshPayloadSchema>;

export const webhookTestPayloadSchema = z
  .discriminatedUnion("action", [
    z
      .object({
        action: z.literal("notify"),
        title: cleanOptionalTrimmedText(80),
        message: cleanTrimmedText(1, 300),
        severity: notificationSeveritySchema.default("info"),
        durationSeconds: z.number().int().min(3).max(120).default(8),
        deviceId: idSchema.optional(),
        panelId: idSchema.optional(),
      })
      .strict(),
    z
      .object({
        action: z.literal("goto"),
        page: gotoPageParamSchema,
        deviceId: idSchema.optional(),
        panelId: idSchema.optional(),
        durationSeconds: z.number().int().min(0).max(3600).default(0),
        refresh: z.boolean().default(false),
      })
      .strict(),
    z
      .object({
        action: z.literal("push"),
        key: pushKeySchema,
        name: cleanOptionalTrimmedText(60, 1),
        title: cleanOptionalTrimmedText(60, 1),
        category: z.enum(["ci", "ai", "service", "deploy"]).optional(),
        status: pushStatusSchema.optional(),
        detail: cleanOptionalTrimmedText(120),
        text: cleanOptionalTrimmedText(120),
        value: cleanPushValueSchema.optional(),
        ttlSeconds: z.number().int().min(30).max(86_400).default(86_400),
      })
      .strict(),
    z
      .object({
        action: z.literal("refresh"),
        deviceId: idSchema.optional(),
        panelId: idSchema.optional(),
      })
      .strict(),
  ])
  .refine(
    (data) =>
      data.action !== "push" ||
      data.status !== undefined ||
      data.detail !== undefined ||
      data.text !== undefined ||
      data.value !== undefined,
    { message: "Informe ao menos um campo de valor, detalhe ou status", path: ["status"] },
  );

export type WebhookTestPayload = z.infer<typeof webhookTestPayloadSchema>;
