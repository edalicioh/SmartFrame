import { z } from "zod";

export const widgetBackground = z
  .union([z.literal(""), z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/)])
  .default("");

export const widgetCardSize = z.enum(["small", "normal", "large"]).default("normal");

export const appearancePresets = ["default", "cards", "flat", "borderless", "seamless"] as const;

export const appearancePresetSchema = z.enum(appearancePresets);
export type AppearancePreset = z.infer<typeof appearancePresetSchema>;

export const scopedAppearanceFields = {
  preset: appearancePresetSchema.nullable().optional(),
  cornerRadius: z.number().int().min(0).max(32).nullable().optional(),
  widgetSpacing: z.number().int().min(0).max(24).nullable().optional(),
  innerPadding: z.number().int().min(0).max(24).nullable().optional(),
  pageEdgePadding: z.number().int().min(0).max(32).nullable().optional(),
  border: z.boolean().nullable().optional(),
  shadow: z.boolean().nullable().optional(),
};

export const scopedAppearanceSchema = z.object(scopedAppearanceFields).strict();
export type ScopedAppearance = z.infer<typeof scopedAppearanceSchema>;

export const widgetAppearanceFields = {
  preset: scopedAppearanceFields.preset,
  cornerRadius: scopedAppearanceFields.cornerRadius,
  innerPadding: scopedAppearanceFields.innerPadding,
  border: scopedAppearanceFields.border,
  shadow: scopedAppearanceFields.shadow,
};

export function stripPageOnlyAppearanceFields(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const record = { ...(input as Record<string, unknown>) };
  delete record.widgetSpacing;
  delete record.pageEdgePadding;
  return record;
}

export const widgetAppearanceOverrideSchema = z.preprocess(
  stripPageOnlyAppearanceFields,
  z.object(widgetAppearanceFields).strict(),
);
export type WidgetAppearanceOverride = z.infer<typeof widgetAppearanceOverrideSchema>;

export type ResolvedScopedAppearance = {
  preset: AppearancePreset;
  surfaceMode: AppearancePreset;
  cornerRadius: number | null;
  widgetSpacing: number | null;
  innerPadding: number | null;
  pageEdgePadding: number | null;
  border: boolean | null;
  shadow: boolean | null;
};

const PRESET_DEFAULTS: Record<AppearancePreset, ResolvedScopedAppearance> = {
  default: {
    preset: "default",
    surfaceMode: "default",
    cornerRadius: null,
    widgetSpacing: null,
    innerPadding: null,
    pageEdgePadding: null,
    border: null,
    shadow: null,
  },
  cards: {
    preset: "cards",
    surfaceMode: "cards",
    cornerRadius: 18,
    widgetSpacing: 12,
    innerPadding: 12,
    pageEdgePadding: 12,
    border: true,
    shadow: false,
  },
  flat: {
    preset: "flat",
    surfaceMode: "flat",
    cornerRadius: 12,
    widgetSpacing: 12,
    innerPadding: 12,
    pageEdgePadding: 12,
    border: false,
    shadow: false,
  },
  borderless: {
    preset: "borderless",
    surfaceMode: "borderless",
    cornerRadius: 0,
    widgetSpacing: 12,
    innerPadding: 12,
    pageEdgePadding: 12,
    border: false,
    shadow: false,
  },
  seamless: {
    preset: "seamless",
    surfaceMode: "seamless",
    cornerRadius: 0,
    widgetSpacing: 0,
    innerPadding: 12,
    pageEdgePadding: 0,
    border: true,
    shadow: false,
  },
};

function pickExplicit<T>(override: T | null | undefined, fallback: T | null): T | null {
  return override !== undefined && override !== null ? override : fallback;
}

/** Resolve global/page appearance and optional per-widget overrides without discarding 0 or false. */
export function resolveScopedAppearance(
  globalAppearance?: ScopedAppearance | null,
  widgetAppearance?: WidgetAppearanceOverride | null,
): ResolvedScopedAppearance {
  const globalPreset: AppearancePreset = globalAppearance?.preset ?? "default";
  const globalBase = PRESET_DEFAULTS[globalPreset];
  const resolvedGlobal: ResolvedScopedAppearance = {
    preset: globalPreset,
    surfaceMode: globalBase.surfaceMode,
    cornerRadius: pickExplicit(globalAppearance?.cornerRadius, globalBase.cornerRadius),
    widgetSpacing: pickExplicit(globalAppearance?.widgetSpacing, globalBase.widgetSpacing),
    innerPadding: pickExplicit(globalAppearance?.innerPadding, globalBase.innerPadding),
    pageEdgePadding: pickExplicit(globalAppearance?.pageEdgePadding, globalBase.pageEdgePadding),
    border: pickExplicit(globalAppearance?.border, globalBase.border),
    shadow: pickExplicit(globalAppearance?.shadow, globalBase.shadow),
  };

  if (!widgetAppearance) return resolvedGlobal;

  const hasWidgetPreset = widgetAppearance.preset !== undefined && widgetAppearance.preset !== null;
  const widgetBase = hasWidgetPreset ? PRESET_DEFAULTS[widgetAppearance.preset!] : resolvedGlobal;

  return {
    preset: hasWidgetPreset ? widgetAppearance.preset! : resolvedGlobal.preset,
    surfaceMode: widgetBase.surfaceMode,
    cornerRadius: pickExplicit(widgetAppearance.cornerRadius, widgetBase.cornerRadius),
    widgetSpacing: resolvedGlobal.widgetSpacing,
    innerPadding: pickExplicit(widgetAppearance.innerPadding, widgetBase.innerPadding),
    pageEdgePadding: resolvedGlobal.pageEdgePadding,
    border: pickExplicit(widgetAppearance.border, widgetBase.border),
    shadow: pickExplicit(widgetAppearance.shadow, widgetBase.shadow),
  };
}
