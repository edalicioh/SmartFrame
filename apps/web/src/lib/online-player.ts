import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, readFile, realpath } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { FrameError } from "@smartframe/frames";
import sharp from "sharp";
import type { Metadata } from "sharp";
import { z } from "zod";
import { onlineCurrenciesSchema, defaultOnlineDashboard } from "@smartframe/contracts";

const seconds = (min: number, max: number, value: number) =>
  z.number().int().min(min).max(max).default(value);
const configSchema = z
  .object({
    layout: z.literal("photo-dashboard").default("photo-dashboard"),
    orientation: z.enum(["landscape", "portrait"]).default("landscape"),
    theme: z.enum(["light", "dark"]).default("light"),
    refreshSeconds: seconds(10, 3600, 60),
    layoutOptions: z
      .object({
        photoPosition: z.enum(["left", "right"]).default("left"),
        photoWidthPercent: z.number().int().min(40).max(75).default(62),
      })
      .strict()
      .default({ photoPosition: "left", photoWidthPercent: 62 }),
    widgets: z
      .object({
        photos: z
          .object({
            enabled: z.boolean().default(true),
            intervalSeconds: seconds(5, 3600, 15),
            fit: z.enum(["cover", "contain"]).default("cover"),
          })
          .strict()
          .default({ enabled: true, intervalSeconds: 15, fit: "cover" }),
        clock: z
          .object({
            enabled: z.boolean().default(true),
            format: z.enum(["12h", "24h"]).default("24h"),
            showDate: z.boolean().default(true),
            size: z.enum(["small", "normal", "large"]).default("normal"),
            color: z
              .union([z.literal(""), z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/)])
              .default(""),
          })
          .strict()
          .default({ enabled: true, format: "24h", showDate: true, size: "normal", color: "" }),
        weather: z
          .object({
            enabled: z.boolean().default(true),
            city: z.string().trim().min(1).max(80).default("Camboriú"),
          })
          .strict()
          .default({ enabled: true, city: "Camboriú" }),
        currencies: onlineCurrenciesSchema.prefault({}),
        calendar: z
          .object({ enabled: z.boolean().default(true), highlightToday: z.boolean().default(true) })
          .strict()
          .default({ enabled: true, highlightToday: true }),
      })
      .strict()
      .default({
        photos: { enabled: true, intervalSeconds: 15, fit: "cover" },
        clock: { enabled: true, format: "24h", showDate: true, size: "normal", color: "" },
        weather: { enabled: true, city: "Camboriú" },
        currencies: defaultOnlineDashboard.widgets.currencies,
        calendar: { enabled: true, highlightToday: true },
      }),
  })
  .strict();

const maxPhotoBytes = 16 * 1024 * 1024;
const maxPhotoAxis = 4096;
const maxPhotoPixels = 2_097_152;
// Keep the complete relative URL well below 512 characters, including its version hash.
const maxEncodedName = 350;
const maxScanBytes = 128 * 1024 * 1024;
const maxCandidates = 4096;
const maxConfigBytes = 1024 * 1024;
// Process-wide token bucket; charge before reading, even for an invalid or changing file.
const ioBurstBytes = 256 * 1024 * 1024;
// Replenish one maximum-size scan per minimum allowed polling interval.
const ioBytesPerMs = maxScanBytes / 10_000;
let ioTokens = ioBurstBytes;
let ioUpdatedAt = Date.now();
function reserveScanIo(size: number) {
  const now = Date.now();
  ioTokens = Math.min(ioBurstBytes, ioTokens + Math.max(0, now - ioUpdatedAt) * ioBytesPerMs);
  ioUpdatedAt = Math.max(ioUpdatedAt, now);
  if (size > ioTokens)
    throw new FrameError(429, "Limite temporário de leitura do álbum atingido. Tente novamente.");
  ioTokens -= size;
}
const contentTypes: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};
const hash = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === "ENOENT";

function imageType(name: string, bytes: Buffer) {
  const type = contentTypes[extname(name).toLowerCase()];
  if (type === "image/jpeg" && bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])))
    return type;
  if (
    type === "image/png" &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return type;
  if (
    type === "image/webp" &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  )
    return type;
  return null;
}

function validName(name: string) {
  return (
    name.length > 0 &&
    name !== "." &&
    name !== ".." &&
    basename(name) === name &&
    !/[\\/\0]/.test(name) &&
    Boolean(contentTypes[extname(name).toLowerCase()])
  );
}

export function photoId(name: string) {
  const encoded = Buffer.from(name, "utf8").toString("base64url");
  return encoded.length <= maxEncodedName ? encoded : `h-${hash(name)}`;
}

function nameFromId(id: string) {
  if (!/^[A-Za-z0-9_-]{1,350}$/.test(id)) return null;
  const name = Buffer.from(id, "base64url").toString("utf8");
  return photoId(name) === id && validName(name) ? name : null;
}

// Only a single regular file directly inside the configured, trusted directory is served.
export async function readOnlinePhoto(
  directory: string,
  id: string,
  reserve?: (size: number) => void,
) {
  let name = nameFromId(id);
  if (!name && /^h-[a-f0-9]{64}$/.test(id)) {
    try {
      const names = (await readdir(directory)).filter(validName);
      if (names.length > maxCandidates)
        throw new FrameError(413, "Álbum excede o limite de 4096 arquivos candidatos.");
      const matches = names.filter((candidate) => photoId(candidate) === id);
      if (matches.length === 1) name = matches[0];
    } catch (error) {
      if (!missing(error)) throw error;
    }
  }
  return name ? readOnlinePhotoByName(directory, name, reserve) : null;
}

async function readOnlinePhotoByName(
  directory: string,
  name: string,
  reserve?: (size: number) => void,
) {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const root = await realpath(directory);
    const path = join(root, name);
    const before = await lstat(path);
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      before.nlink > 1 ||
      before.size > maxPhotoBytes
    )
      return null;
    if ((await realpath(path)) !== path) return null;
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const stat = await handle.stat();
    if (
      !stat.isFile() ||
      stat.nlink > 1 ||
      stat.size > maxPhotoBytes ||
      stat.ino !== before.ino ||
      stat.dev !== before.dev
    )
      return null;
    reserve?.(stat.size);
    // Allocate only the size checked above, even if another process grows the file.
    const bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const result = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!result.bytesRead) return null;
      offset += result.bytesRead;
    }
    const after = await handle.stat();
    const current = await lstat(path);
    if (
      bytes.length > maxPhotoBytes ||
      after.size !== stat.size ||
      after.mtimeMs !== stat.mtimeMs ||
      after.ctimeMs !== stat.ctimeMs ||
      after.nlink !== 1 ||
      !current.isFile() ||
      current.nlink !== 1 ||
      current.dev !== stat.dev ||
      current.ino !== stat.ino ||
      current.size !== after.size ||
      current.mtimeMs !== after.mtimeMs ||
      current.ctimeMs !== after.ctimeMs ||
      (await realpath(path)) !== path
    )
      return null;
    const type = imageType(name, bytes);
    if (!type) return null;
    // Inspect the immutable, already checked buffer, not a second read of the path.
    let metadata: Metadata;
    try {
      metadata = await sharp(bytes, { animated: false, limitInputPixels: false }).metadata();
    } catch {
      return null;
    }
    const { width, height, format } = metadata;
    if (
      !width ||
      !height ||
      width > maxPhotoAxis ||
      height > maxPhotoAxis ||
      width * height > maxPhotoPixels ||
      `image/${format}` !== type
    )
      return null;
    return { bytes, type, digest: hash(bytes), name };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code ?? "";
    if (["EACCES", "EPERM"].includes(code)) {
      console.warn("SmartFrame: foto indisponível por permissões de leitura.");
      return null;
    }
    if (["ENOENT", "ELOOP", "ENOTDIR"].includes(code)) return null;
    throw error;
  } finally {
    await handle?.close();
  }
}

async function scanOnlineConfig(configPath: string, photoDirectory: string) {
  let input: unknown = {};
  try {
    input = JSON.parse(await readFile(configPath, "utf8"));
  } catch (error) {
    if (!missing(error)) throw error;
  }
  const config = configSchema.parse(input);
  let names: string[];
  try {
    names = await readdir(photoDirectory);
  } catch (error) {
    if (!missing(error)) throw error;
    names = [];
  }
  names.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  if (names.filter(validName).length > maxCandidates)
    throw new FrameError(413, "Álbum excede o limite de 4096 arquivos candidatos.");
  const items: { id: string; src: string; alt: string }[] = [];
  let scanBytes = 0;
  for (const name of names) {
    if (!validName(name)) continue;
    const id = photoId(name);
    const photo = await readOnlinePhotoByName(photoDirectory, name, (size) => {
      scanBytes += size;
      if (scanBytes > maxScanBytes)
        throw new FrameError(413, "Álbum excede o limite de 128 MiB por varredura.");
      reserveScanIo(size);
    });
    if (photo)
      items.push({
        id,
        src: `/api/player/online-photos/${id}?v=${photo.digest}`,
        alt: name.slice(0, -extname(name).length),
      });
  }
  const output = {
    ...config,
    widgets: { ...config.widgets, photos: { ...config.widgets.photos, items } },
  };
  const result = { revision: hash(JSON.stringify(output)), ...output };
  if (Buffer.byteLength(JSON.stringify(result), "utf8") > maxConfigBytes)
    throw new FrameError(413, "Configuração do player excede o limite de 1 MiB de JSON.");
  return result;
}

// Share only active scans, never a completed result: even same-size changes with restored
// timestamps must be hashed again on the next scan. Key both paths to prevent mixing albums.
const activeScans = new Map<string, Promise<Awaited<ReturnType<typeof scanOnlineConfig>>>>();
export function onlineConfig(configPath: string, photoDirectory: string) {
  const key = JSON.stringify([configPath, photoDirectory]);
  const active = activeScans.get(key);
  if (active) return active;
  const scan = scanOnlineConfig(configPath, photoDirectory);
  activeScans.set(key, scan);
  void scan
    .finally(() => {
      if (activeScans.get(key) === scan) activeScans.delete(key);
    })
    .catch(() => {});
  return scan;
}

export function onlinePaths() {
  return {
    // Runtime data is supplied by the operator, not a build-time asset to trace or bundle.
    config: resolve(
      /* turbopackIgnore: true */ process.env.SMARTFRAME_ONLINE_CONFIG ??
        ".data/player-online/config.json",
    ),
    photos: resolve(
      /* turbopackIgnore: true */ process.env.SMARTFRAME_ONLINE_PHOTOS ??
        ".data/player-online/photos",
    ),
  };
}
