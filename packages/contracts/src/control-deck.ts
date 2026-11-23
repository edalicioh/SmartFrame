import { z } from "zod";
import {
  widgetAppearanceOverrideSchema,
  widgetBackground,
} from "./widget-style";

function stripControlChars(value: string): string {
  return value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
}

const cleanText = (min: number, max: number) =>
  z
    .string()
    .transform((value) => stripControlChars(value).trim())
    .pipe(z.string().min(min).max(max));

const idSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,128}$/, "Identificador inválido.");
const shortIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,64}$/, "Use apenas letras, números, '-' e '_' (1 a 64 caracteres).");
const executionIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{8,64}$/, "executionId inválido.");
const appNameSchema = z
  .string()
  .transform((value) => stripControlChars(value).trim())
  .pipe(z.string().regex(/^[A-Za-z0-9._ -]{1,64}$/, "Nome de aplicativo inválido"));

export const controlDeckKinds = [
  "shortcut",
  "media",
  "volume",
  "app_volume",
  "brightness",
  "mic_ptt",
] as const;

export type ControlDeckKind = (typeof controlDeckKinds)[number];
export const controlDeckKindSchema = z.enum(controlDeckKinds);

export const controlDeckIcons = [
  "bolt",
  "play",
  "next",
  "prev",
  "stop",
  "volume",
  "mute",
  "app",
  "mic",
  "sun",
  "terminal",
] as const;

export type ControlDeckIcon = (typeof controlDeckIcons)[number];
export const controlDeckIconSchema = z.enum(controlDeckIcons);

export const controlDeckActionsByKind = {
  shortcut: ["launch"],
  media: ["play_pause", "next", "previous", "stop"],
  volume: ["mute_toggle", "set_mute", "step_up", "step_down", "set_level"],
  app_volume: ["mute_toggle", "set_level"],
  brightness: ["step_up", "step_down", "set_level"],
  mic_ptt: ["hold_unmute", "toggle_mute", "set_mute"],
} as const satisfies Record<ControlDeckKind, readonly string[]>;

export type ControlDeckAction =
  (typeof controlDeckActionsByKind)[ControlDeckKind][number];

const IDEMPOTENT_ACTIONS = new Set<string>([
  "volume:set_mute",
  "volume:set_level",
  "app_volume:set_level",
  "brightness:set_level",
  "mic_ptt:set_mute",
  "mic_ptt:hold_unmute",
]);

export function isControlDeckActionIdempotent(
  kind: ControlDeckKind,
  action: string,
): boolean {
  return IDEMPOTENT_ACTIONS.has(`${kind}:${action}`);
}

/** Opaque tile stored in published online configurations: never stores paths, args or secrets. */
export const controlDeckTileSchema = z
  .object({
    id: shortIdSchema,
    bindingId: idSchema,
    bindingRevision: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    label: cleanText(1, 40),
    icon: controlDeckIconSchema.default("bolt"),
  })
  .strict();

export type ControlDeckTile = z.infer<typeof controlDeckTileSchema>;

export const controlDeckWidgetSchema = z
  .object({
    enabled: z.boolean().default(false),
    backgroundColor: widgetBackground,
    appearance: widgetAppearanceOverrideSchema.optional(),
    title: cleanText(1, 80).default("Control Deck"),
    columns: z.number().int().min(2).max(4).default(3),
    tiles: z
      .array(controlDeckTileSchema)
      .max(16)
      .refine(
        (items) => new Set(items.map((item) => item.id)).size === items.length,
        "Botões duplicados no Control Deck",
      )
      .default([]),
  })
  .strict();

export type ControlDeckWidget = z.infer<typeof controlDeckWidgetSchema>;

const shortcutSpecSchema = z
  .object({
    kind: z.literal("shortcut"),
    action: z.enum(controlDeckActionsByKind.shortcut),
    target: z
      .object({
        shortcutId: shortIdSchema,
      })
      .strict(),
  })
  .strict();

const mediaSpecSchema = z
  .object({
    kind: z.literal("media"),
    action: z.enum(controlDeckActionsByKind.media),
    target: z.object({}).strict().default({}),
  })
  .strict();

const volumeSpecSchema = z
  .object({
    kind: z.literal("volume"),
    action: z.enum(controlDeckActionsByKind.volume),
    target: z
      .object({
        step: z
          .number()
          .int("Passo deve ser um número inteiro.")
          .min(1, "Passo mínimo é 1%.")
          .max(25, "Passo máximo é 25%.")
          .default(5),
      })
      .strict()
      .default({ step: 5 }),
  })
  .strict();

const appVolumeSpecSchema = z
  .object({
    kind: z.literal("app_volume"),
    action: z.enum(controlDeckActionsByKind.app_volume),
    target: z
      .object({
        appName: appNameSchema,
      })
      .strict(),
  })
  .strict();

const brightnessSpecSchema = z
  .object({
    kind: z.literal("brightness"),
    action: z.enum(controlDeckActionsByKind.brightness),
    target: z
      .object({
        step: z
          .number()
          .int("Passo deve ser um número inteiro.")
          .min(1, "Passo mínimo é 1%.")
          .max(25, "Passo máximo é 25%.")
          .default(10),
      })
      .strict()
      .default({ step: 10 }),
  })
  .strict();

const micPttSpecSchema = z
  .object({
    kind: z.literal("mic_ptt"),
    action: z.enum(controlDeckActionsByKind.mic_ptt),
    target: z
      .object({
        leaseSeconds: z
          .number()
          .int("Duração do lease deve ser inteira.")
          .min(2, "Lease mínimo de 2 segundos.")
          .max(30, "Lease máximo de 30 segundos.")
          .default(10),
      })
      .strict()
      .default({ leaseSeconds: 10 }),
  })
  .strict();

export const controlDeckBindingTargetSchema = z.discriminatedUnion("kind", [
  shortcutSpecSchema,
  mediaSpecSchema,
  volumeSpecSchema,
  appVolumeSpecSchema,
  brightnessSpecSchema,
  micPttSpecSchema,
]);

export type ControlDeckBindingSpec = z.infer<typeof controlDeckBindingTargetSchema>;

export const controlDeckBindingCreateSchema = z.discriminatedUnion("kind", [
  shortcutSpecSchema.extend({
    label: cleanText(1, 60),
    enabled: z.boolean().default(true),
  }),
  mediaSpecSchema.extend({
    label: cleanText(1, 60),
    enabled: z.boolean().default(true),
  }),
  volumeSpecSchema.extend({
    label: cleanText(1, 60),
    enabled: z.boolean().default(true),
  }),
  appVolumeSpecSchema.extend({
    label: cleanText(1, 60),
    enabled: z.boolean().default(true),
  }),
  brightnessSpecSchema.extend({
    label: cleanText(1, 60),
    enabled: z.boolean().default(true),
  }),
  micPttSpecSchema.extend({
    label: cleanText(1, 60),
    enabled: z.boolean().default(true),
  }),
]);

export type ControlDeckBindingCreateInput = z.infer<
  typeof controlDeckBindingCreateSchema
>;

export const controlDeckBindingUpdateSchema = z.discriminatedUnion("kind", [
  shortcutSpecSchema.extend({
    id: idSchema,
    label: cleanText(1, 60),
    enabled: z.boolean().default(true),
  }),
  mediaSpecSchema.extend({
    id: idSchema,
    label: cleanText(1, 60),
    enabled: z.boolean().default(true),
  }),
  volumeSpecSchema.extend({
    id: idSchema,
    label: cleanText(1, 60),
    enabled: z.boolean().default(true),
  }),
  appVolumeSpecSchema.extend({
    id: idSchema,
    label: cleanText(1, 60),
    enabled: z.boolean().default(true),
  }),
  brightnessSpecSchema.extend({
    id: idSchema,
    label: cleanText(1, 60),
    enabled: z.boolean().default(true),
  }),
  micPttSpecSchema.extend({
    id: idSchema,
    label: cleanText(1, 60),
    enabled: z.boolean().default(true),
  }),
]);

export type ControlDeckBindingUpdateInput = z.infer<
  typeof controlDeckBindingUpdateSchema
>;

export const controlDeckExecuteCommandTypes = [
  "trigger",
  "set_level",
  "set_mute",
  "ptt_acquire",
  "ptt_renew",
  "ptt_release",
] as const;

export type ControlDeckExecuteCommand =
  (typeof controlDeckExecuteCommandTypes)[number];

export const controlDeckExecuteRequestSchema = z
  .object({
    executionId: executionIdSchema,
    revision: z.string().regex(/^online:[A-Za-z0-9_-]{1,128}$/),
    bindingId: idSchema,
    command: z.enum(controlDeckExecuteCommandTypes).default("trigger"),
    value: z.number().int().min(0).max(100).optional(),
    muted: z.boolean().optional(),
    leaseSeconds: z.number().int().min(2).max(30).optional(),
    leaseId: idSchema.optional(),
    leaseRequestId: executionIdSchema.optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    const isPtt =
      data.command === "ptt_acquire" ||
      data.command === "ptt_renew" ||
      data.command === "ptt_release";
    if (!isPtt && data.leaseRequestId !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["leaseRequestId"],
        message: "leaseRequestId só é permitido em comandos Push-to-Talk.",
      });
    }
    if (
      data.command === "ptt_acquire" &&
      (!data.leaseRequestId || data.leaseRequestId !== data.executionId)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["leaseRequestId"],
        message: "leaseRequestId deve corresponder ao executionId da aquisição.",
      });
    }
    if (
      data.command === "ptt_release" &&
      data.leaseId === undefined &&
      data.leaseRequestId === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["leaseRequestId"],
        message: "leaseRequestId obrigatório para release sem leaseId.",
      });
    }
  });

export type ControlDeckExecuteRequest = z.infer<
  typeof controlDeckExecuteRequestSchema
>;

export const controlDeckAgentExecuteSchema = z
  .object({
    deviceId: idSchema,
    executionId: executionIdSchema,
    bindingId: idSchema,
    kind: controlDeckKindSchema,
    action: z.string().min(1).max(40),
    target: z.record(z.string(), z.unknown()).default({}),
    idempotent: z.boolean(),
    command: z.enum(controlDeckExecuteCommandTypes).default("trigger"),
    value: z.number().int().min(0).max(100).optional(),
    muted: z.boolean().optional(),
    leaseSeconds: z.number().int().min(2).max(30).optional(),
    leaseId: idSchema.optional(),
    leaseRequestId: executionIdSchema.optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    const specResult = controlDeckBindingTargetSchema.safeParse({
      kind: data.kind,
      action: data.action,
      target: data.target,
    });
    if (!specResult.success) {
      for (const issue of specResult.error.issues) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: issue.path,
          message: issue.message,
        });
      }
      return;
    }

    const spec = specResult.data;
    const isPtt =
      data.command === "ptt_acquire" ||
      data.command === "ptt_renew" ||
      data.command === "ptt_release";
    const hasLeaseRequestId = data.leaseRequestId !== undefined;

    if (spec.kind === "mic_ptt" && spec.action === "hold_unmute") {
      if (!isPtt) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["command"],
          message: "Comando incompatível com Push-to-Talk.",
        });
      }
      if (data.value !== undefined || data.muted !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["command"],
          message: "Parâmetros extras incompatíveis com Push-to-Talk.",
        });
      }
      if (data.command === "ptt_acquire" && data.leaseId !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["leaseId"],
          message: "leaseId não permitido ao adquirir Push-to-Talk.",
        });
      }
      if (
        data.command === "ptt_acquire" &&
        (!data.leaseRequestId || data.leaseRequestId !== data.executionId)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["leaseRequestId"],
          message: "leaseRequestId deve corresponder ao executionId da aquisição.",
        });
      }
      if (data.command === "ptt_renew" && !data.leaseId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["leaseId"],
          message: "leaseId obrigatório para renovar Push-to-Talk.",
        });
      }
      if (
        data.command === "ptt_release" &&
        data.leaseId === undefined &&
        !hasLeaseRequestId
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["leaseRequestId"],
          message: "leaseRequestId obrigatório para release sem leaseId.",
        });
      }
      return;
    }

    if (
      isPtt ||
      data.leaseSeconds !== undefined ||
      data.leaseId !== undefined ||
      hasLeaseRequestId
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["command"],
        message: "Parâmetros Push-to-Talk inválidos para este vínculo.",
      });
    }
    if (spec.action === "set_level") {
      if (data.command !== "set_level" || data.value === undefined || data.muted !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["value"],
          message: "Comando set_level exige value entre 0 e 100.",
        });
      }
      return;
    }
    if (spec.action === "set_mute") {
      if (data.command !== "set_mute" || data.muted === undefined || data.value !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["muted"],
          message: "Comando set_mute exige muted booleano.",
        });
      }
      return;
    }
    if (data.command !== "trigger" || data.value !== undefined || data.muted !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["command"],
        message: "Este vínculo aceita apenas trigger sem parâmetros extras.",
      });
    }
  });

export type ControlDeckAgentExecutePayload = z.infer<
  typeof controlDeckAgentExecuteSchema
>;

export const controlDeckPublicShortcutSchema = z
  .object({
    shortcutId: shortIdSchema,
    label: cleanText(1, 60),
    available: z.boolean(),
  })
  .strict();

export type ControlDeckPublicShortcut = z.infer<
  typeof controlDeckPublicShortcutSchema
>;

export const controlDeckHostStatusSchema = z
  .object({
    available: z.boolean(),
    platform: z.enum(["win32", "linux", "unsupported"]).default("unsupported"),
    checkedAt: z.string(),
    capabilities: z
      .object({
        shortcuts: z.boolean(),
        media: z.boolean(),
        volume: z.boolean(),
        appVolume: z.boolean(),
        brightness: z.boolean(),
        mic: z.boolean(),
      })
      .strict(),
    volume: z
      .object({
        available: z.boolean(),
        level: z.number().int().min(0).max(100).nullable(),
        muted: z.boolean().nullable(),
      })
      .strict(),
    brightness: z
      .object({
        available: z.boolean(),
        level: z.number().int().min(0).max(100).nullable(),
      })
      .strict(),
    mic: z
      .object({
        available: z.boolean(),
        muted: z.boolean().nullable(),
        pttActive: z.boolean(),
        leaseId: z.string().nullable(),
        leaseExpiresAt: z.string().nullable(),
      })
      .strict(),
    media: z
      .object({
        available: z.boolean(),
        playbackState: z.enum(["playing", "paused", "stopped", "unknown"]),
      })
      .strict(),
    shortcuts: z.array(controlDeckPublicShortcutSchema).max(100),
  })
  .strict();

export type ControlDeckHostStatus = z.infer<typeof controlDeckHostStatusSchema>;

export const controlDeckPlayerBindingSchema = z
  .object({
    bindingId: idSchema,
    label: cleanText(1, 60),
    kind: controlDeckKindSchema,
    action: z.string().min(1).max(40),
    idempotent: z.boolean(),
    available: z.boolean(),
    level: z.number().int().min(0).max(100).nullable(),
    muted: z.boolean().nullable(),
    leaseSeconds: z.number().int().min(2).max(30).nullable(),
  })
  .strict();

export type ControlDeckPlayerBinding = z.infer<
  typeof controlDeckPlayerBindingSchema
>;

export const controlDeckPlayerWidgetDataSchema = z
  .object({
    available: z.boolean(),
    checkedAt: z.string().nullable(),
    hostStatus: z
      .object({
        volume: controlDeckHostStatusSchema.shape.volume,
        brightness: controlDeckHostStatusSchema.shape.brightness,
        mic: z
          .object({
            available: z.boolean(),
            muted: z.boolean().nullable(),
            pttActive: z.boolean(),
            leaseExpiresAt: z.string().nullable(),
          })
          .strict(),
        media: controlDeckHostStatusSchema.shape.media,
      })
      .strict(),
    bindings: z.record(idSchema, controlDeckPlayerBindingSchema),
  })
  .strict();

export type ControlDeckPlayerWidgetData = z.infer<
  typeof controlDeckPlayerWidgetDataSchema
>;

export const controlDeckExecuteStatusSchema = z.enum([
  "ok",
  "unavailable",
  "unknown",
  "rejected",
  "error",
]);

export type ControlDeckExecuteStatus = z.infer<
  typeof controlDeckExecuteStatusSchema
>;

export const controlDeckExecuteResultSchema = z
  .object({
    status: controlDeckExecuteStatusSchema,
    bindingId: idSchema,
    executionId: executionIdSchema,
    idempotent: z.boolean(),
    message: z.string().max(240),
    state: z
      .object({
        level: z.number().int().min(0).max(100).nullable().optional(),
        muted: z.boolean().nullable().optional(),
        playbackState: z
          .enum(["playing", "paused", "stopped", "unknown"])
          .optional(),
      })
      .strict()
      .optional(),
    lease: z
      .object({
        leaseId: idSchema,
        expiresAt: z.string(),
        leaseSeconds: z.number().int().min(2).max(30),
      })
      .strict()
      .optional(),
  })
  .strict();

export type ControlDeckExecuteResult = z.infer<
  typeof controlDeckExecuteResultSchema
>;

export function unavailableControlDeckHostStatus(
  checkedAt = new Date().toISOString(),
): ControlDeckHostStatus {
  return {
    available: false,
    platform: "unsupported",
    checkedAt,
    capabilities: {
      shortcuts: false,
      media: false,
      volume: false,
      appVolume: false,
      brightness: false,
      mic: false,
    },
    volume: { available: false, level: null, muted: null },
    brightness: { available: false, level: null },
    mic: {
      available: false,
      muted: null,
      pttActive: false,
      leaseId: null,
      leaseExpiresAt: null,
    },
    media: { available: false, playbackState: "unknown" },
    shortcuts: [],
  };
}
