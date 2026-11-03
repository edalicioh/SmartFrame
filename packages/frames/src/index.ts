import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import { cachedWidgetData } from "@smartframe/widgets";
import {
  defaultPhotoFrame,
  manifestSchema,
  photoFrameSchema,
  type PhotoFrame,
} from "@smartframe/contracts";
import type { PrismaClient } from "@smartframe/database";

export class FrameError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const frameKey = (householdId: string) => `photo:${householdId}`;

export function mediaPath(id: string, extension = "webp") {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id) || !["webp", "source", "tmp"].includes(extension))
    throw new Error("Identificador de mídia inválido.");
  return resolve(process.env.STORAGE_PATH ?? ".data/media", `${id}.${extension}`);
}

export async function frameState(db: PrismaClient, householdId: string) {
  const layout = await db.layout.findUnique({ where: { key: frameKey(householdId) } });
  const config = layout?.draft
    ? photoFrameSchema.parse(layout.draft)
    : structuredClone(defaultPhotoFrame);
  const photo = config.background.photoId
    ? await db.media.findFirst({
        where: { id: config.background.photoId, householdId },
        select: { id: true, status: true, filename: true },
      })
    : null;
  const devices = await db.device.findMany({
    where: { householdId, revokedAt: null },
    select: { id: true, name: true, lastSeenAt: true, appliedRevision: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return {
    checkedAt: Date.now(),
    config,
    draftRevision: layout?.draftRevision ?? 0,
    publishedRevision: layout?.publishedVersionId ?? null,
    photo,
    devices,
    widgetData: await cachedWidgetData(db, config),
  };
}

export async function saveFrame(
  db: PrismaClient,
  householdId: string,
  actorId: string,
  input: unknown,
  expectedRevision: number,
) {
  const config = photoFrameSchema.parse(input);
  if (
    config.background.photoId &&
    !(await db.media.findFirst({ where: { id: config.background.photoId, householdId } }))
  )
    throw new FrameError(400, "Foto não pertence à conta.");
  return db.$transaction(async (tx) => {
    const layout = await tx.layout.upsert({
      where: { key: frameKey(householdId) },
      create: { key: frameKey(householdId), householdId, name: "Meu porta-retratos" },
      update: {},
    });
    const saved = await tx.layout.updateMany({
      where: { id: layout.id, householdId, draftRevision: expectedRevision },
      data: { draft: config, draftRevision: { increment: 1 } },
    });
    if (saved.count !== 1)
      throw new FrameError(409, "O rascunho mudou em outra sessão. Recarregue antes de salvar.");
    await tx.auditLog.create({ data: { householdId, actorId, action: "frame.draft.saved" } });
    return { draftRevision: expectedRevision + 1 };
  });
}

export async function publishFrame(
  db: PrismaClient,
  householdId: string,
  actorId: string,
  expectedRevision: number,
) {
  return db.$transaction(async (tx) => {
    const layout = await tx.layout.findUnique({ where: { key: frameKey(householdId) } });
    if (!layout?.draft || layout.draftRevision !== expectedRevision)
      throw new FrameError(409, "Salve a versão atual do rascunho antes de publicar.");
    const config = photoFrameSchema.parse(layout.draft);
    if (
      config.background.photoId &&
      !(await tx.media.findFirst({
        where: {
          id: config.background.photoId,
          householdId,
          status: "ready",
          sha256: { not: null },
          bytes: { not: null },
        },
      }))
    ) {
      throw new FrameError(409, "Aguarde a foto terminar de processar antes de publicar.");
    }
    const version = await tx.layoutVersion.create({ data: { layoutId: layout.id, config } });
    await tx.layout.update({ where: { id: layout.id }, data: { publishedVersionId: version.id } });
    if (config.widgets.weather.enabled || config.widgets.currencies.enabled)
      await tx.job.create({ data: { id: `widgets:${version.id}`, type: "widgets.refresh" } });
    await tx.auditLog.create({ data: { householdId, actorId, action: "frame.published" } });
    return { revision: version.id };
  });
}

export async function uploadBackground(
  db: PrismaClient,
  householdId: string,
  filename: string,
  bytes: Buffer,
) {
  if (!bytes.length || bytes.length > 12 * 1024 ** 2)
    throw new FrameError(413, "Envie uma imagem de até 12 MB.");
  const photo = await db.media.create({
    data: {
      householdId,
      filename: filename.replace(/[\x00-\x1f]/g, "").slice(0, 200) || "Foto",
      status: "pending",
    },
  });
  try {
    // Dados privados são volumes de runtime, nunca arquivos a incluir no bundle Next.
    await mkdir(
      /* turbopackIgnore: true */ resolve(
        /* turbopackIgnore: true */ process.env.STORAGE_PATH ?? ".data/media",
      ),
      { recursive: true },
    );
    await writeFile(mediaPath(photo.id, "source"), bytes, { flag: "wx" });
    await db.job.create({ data: { id: `background:${photo.id}`, type: "background.optimize" } });
  } catch (error) {
    await db.media.update({ where: { id: photo.id }, data: { status: "error" } });
    await rm(mediaPath(photo.id, "source"), { force: true });
    throw error;
  }
  return { id: photo.id, status: photo.status, filename: photo.filename };
}

export async function optimizeBackground(db: PrismaClient, jobId: string) {
  const id = jobId.replace(/^background:/, "");
  const photo = await db.media.findUnique({ where: { id } });
  if (!photo) return;
  if (photo.status === "ready") {
    await rm(mediaPath(id, "source"), { force: true });
    return;
  }
  try {
    const source = await readFile(mediaPath(id, "source"));
    const metadata = await sharp(source, {
      limitInputPixels: 24_000_000,
      animated: false,
    }).metadata();
    if (!["jpeg", "png", "webp"].includes(metadata.format ?? "") || (metadata.pages ?? 1) > 1)
      throw new Error("Formato não suportado.");
    const { data, info } = await sharp(source, { limitInputPixels: 24_000_000, animated: false })
      .rotate()
      .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    if (data.length > 4 * 1024 ** 2) throw new Error("Imagem otimizada excede o limite.");
    await writeFile(mediaPath(id, "tmp"), data);
    await rename(mediaPath(id, "tmp"), mediaPath(id));
    await db.media.update({
      where: { id },
      data: {
        status: "ready",
        sha256: digest(data),
        bytes: data.length,
        width: info.width,
        height: info.height,
      },
    });
    await rm(mediaPath(id, "source"), { force: true });
  } catch (error) {
    await db.media.update({ where: { id }, data: { status: "error" } });
    throw error;
  }
}

export async function issuePairingCode(db: PrismaClient, householdId: string, actorId: string) {
  const code = randomBytes(5).toString("hex").toUpperCase();
  const expiresAt = new Date(Date.now() + 10 * 60_000);
  await db.$transaction([
    db.pairingCode.create({ data: { householdId, codeHash: digest(code), expiresAt } }),
    db.auditLog.create({ data: { householdId, actorId, action: "device.pairing.issued" } }),
  ]);
  return { code: `${code.slice(0, 5)}-${code.slice(5)}`, expiresAt };
}

export async function limitPairing(db: PrismaClient, ip: string) {
  const now = new Date();
  await db.$transaction(async (tx) => {
    for (const [key, max] of [
      ["pair:global", 100],
      [`pair:${digest(ip)}`, 10],
    ] as const) {
      const record = await tx.requestLimit.upsert({
        where: { key },
        create: { key, windowStart: now },
        update: { count: { increment: 1 } },
      });
      if (now.getTime() - record.windowStart.getTime() >= 300_000) {
        await tx.requestLimit.update({ where: { key }, data: { count: 1, windowStart: now } });
      } else if (record.count > max)
        throw new FrameError(429, "Muitas tentativas de conexão. Aguarde cinco minutos.");
    }
  });
}

export async function redeemPairingCode(db: PrismaClient, code: string, name: string) {
  const normalized = code.replace(/-/g, "").toUpperCase();
  if (!/^[A-F0-9]{10}$/.test(normalized)) throw new FrameError(400, "Código inválido ou expirado.");
  const token = randomBytes(32).toString("base64url");
  return db.$transaction(async (tx) => {
    const pairing = await tx.pairingCode.findUnique({ where: { codeHash: digest(normalized) } });
    if (!pairing) throw new FrameError(400, "Código inválido ou expirado.");
    const used = await tx.pairingCode.updateMany({
      where: { id: pairing.id, redeemedAt: null, expiresAt: { gt: new Date() } },
      data: { redeemedAt: new Date() },
    });
    if (used.count !== 1) throw new FrameError(400, "Código inválido ou expirado.");
    const device = await tx.device.create({
      data: { householdId: pairing.householdId, name, tokenHash: digest(token) },
    });
    await tx.auditLog.create({
      data: { householdId: pairing.householdId, actorId: device.id, action: "device.paired" },
    });
    return { deviceId: device.id, token };
  });
}

export async function authorizePlayer(db: PrismaClient, authorization: string | null) {
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(authorization ?? "");
  if (!match) throw new FrameError(401, "Credencial do dispositivo necessária.");
  const device = await db.device.findFirst({
    where: { tokenHash: digest(match[1]), revokedAt: null },
  });
  if (!device) throw new FrameError(401, "Dispositivo não autorizado.");
  return device;
}

export async function playerManifest(
  db: PrismaClient,
  device: { id: string; householdId: string },
) {
  const layout = await db.layout.findUnique({
    where: { key: frameKey(device.householdId) },
    include: { publishedVersion: true },
  });
  if (!layout?.publishedVersion) return null;
  const frame = photoFrameSchema.parse(layout.publishedVersion.config);
  const photo = frame.background.photoId
    ? await db.media.findFirst({
        where: { id: frame.background.photoId, householdId: device.householdId, status: "ready" },
      })
    : null;
  if (frame.background.photoId && (!photo?.sha256 || !photo.bytes))
    throw new FrameError(503, "Foto publicada indisponível.");
  const portrait = frame.orientation === "portrait";
  return manifestSchema.parse({
    schemaVersion: 1,
    revision: layout.publishedVersion.id,
    deviceId: device.id,
    generatedAt: new Date().toISOString(),
    timezone: frame.timezone,
    layout: {
      width: portrait ? 600 : 1024,
      height: portrait ? 1024 : 600,
      mode: "photo",
      theme: "dark",
      widgets: [],
      photoFrame: frame,
    },
    media: photo
      ? [
          {
            id: photo.id,
            bytes: photo.bytes,
            sha256: photo.sha256,
            path: `/api/player/media/${photo.id}`,
          },
        ]
      : [],
    sync: { pollIntervalSeconds: 30, cacheLimitBytes: 2 * 1024 ** 3 },
    widgetData: await cachedWidgetData(db, frame),
  });
}

export async function acknowledgeFrame(
  db: PrismaClient,
  device: { id: string; householdId: string },
  revision: string | null,
) {
  if (
    revision &&
    !(await db.layoutVersion.findFirst({
      where: { id: revision, layout: { householdId: device.householdId } },
    }))
  )
    throw new FrameError(400, "Revisão desconhecida.");
  await db.device.update({
    where: { id: device.id },
    data: { lastSeenAt: new Date(), ...(revision ? { appliedRevision: revision } : {}) },
  });
}

export async function readBackground(id: string) {
  return readFile(/* turbopackIgnore: true */ mediaPath(id));
}
export type { PhotoFrame };
