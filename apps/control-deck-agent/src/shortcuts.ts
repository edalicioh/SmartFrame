import { constants as fsConstants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { delimiter, isAbsolute, resolve } from "node:path";
import { z } from "zod";
import type { ControlDeckPublicShortcut } from "@smartframe/contracts";

export const localShortcutEntrySchema = z
  .object({
    label: z.string().trim().min(1).max(60),
    command: z.string().trim().min(1).max(512),
    args: z.array(z.string().max(512)).max(32).default([]),
    cwd: z.string().trim().min(1).max(512).optional(),
  })
  .strict();

export const localShortcutsFileSchema = z
  .object({
    shortcuts: z
      .record(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), localShortcutEntrySchema)
      .default({}),
  })
  .strict();

export type LocalShortcutDefinition = z.infer<typeof localShortcutEntrySchema>;
export type LocalShortcutsMap = Record<string, LocalShortcutDefinition>;

export function isWindowsCommandScript(command: string): boolean {
  return /\.(?:cmd|bat)$/i.test(command);
}

export async function loadShortcutsFromFile(
  filePath?: string,
): Promise<LocalShortcutsMap> {
  const trimmed = filePath?.trim();
  if (!trimmed) return {};
  try {
    const raw = await readFile(resolve(trimmed), "utf8");
    const parsed = localShortcutsFileSchema.parse(JSON.parse(raw));
    return parsed.shortcuts;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

export async function commandExists(command: string): Promise<boolean> {
  if (!command || /[\x00-\x1f]/.test(command)) return false;
  // spawn(shell:false) cannot execute Windows command scripts reliably.
  if (process.platform === "win32" && isWindowsCommandScript(command)) return false;
  const checkFlag =
    process.platform === "win32" ? fsConstants.F_OK : fsConstants.X_OK;
  if (isAbsolute(command) || command.includes("/") || command.includes("\\")) {
    try {
      await access(command, checkFlag);
      return true;
    } catch {
      return false;
    }
  }
  const pathEnv = process.env.PATH ?? "";
  const dirs = pathEnv.split(delimiter).filter(Boolean);
  const exts =
    process.platform === "win32"
        ? ["", ...(process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";").filter(Boolean)
            .filter((ext) => !/^\.(?:cmd|bat)$/i.test(ext))]
      : [""];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = resolve(dir, command.endsWith(ext) ? command : command + ext);
      try {
        await access(candidate, checkFlag);
        return true;
      } catch {
        // continue searching PATH
      }
    }
  }
  return false;
}

export async function listPublicShortcuts(
  shortcuts: LocalShortcutsMap,
  existsCheck: (command: string) => Promise<boolean> = commandExists,
): Promise<ControlDeckPublicShortcut[]> {
  const entries = Object.entries(shortcuts).slice(0, 100);
  return Promise.all(
    entries.map(async ([shortcutId, entry]) => ({
      shortcutId,
      label: entry.label,
      available: await existsCheck(entry.command),
    })),
  );
}
