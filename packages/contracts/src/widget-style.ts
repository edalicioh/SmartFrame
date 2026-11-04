import { z } from "zod";

export const widgetBackground = z
  .union([z.literal(""), z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/)])
  .default("");

export const widgetCardSize = z.enum(["small", "normal", "large"]).default("normal");
