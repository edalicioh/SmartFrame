import { randomUUID } from "node:crypto";
import { link, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { createDatabase } from "@smartframe/database";
import { issuePairingCode, redeemPairingCode } from "@smartframe/frames";
import { checkOnlinePlayer } from "../apps/web/src/lib/online-player-authorization";
import { onlineConfig, photoId, readOnlinePhoto } from "../apps/web/src/lib/online-player";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64",
);
let jpeg: Buffer;
let webp: Buffer;
let root: string;
let photos: string;
let config: string;

beforeAll(async () => {
  root = await mkdtemp(join(process.env.TEMP ?? tmpdir(), "smartframe-online-test-"));
  photos = join(root, "photos");
  config = join(root, "config.json");
  await mkdir(photos);
  jpeg = await sharp({ create: { width: 1, height: 1, channels: 3, background: "red" } })
    .jpeg()
    .toBuffer();
  webp = await sharp({ create: { width: 1, height: 1, channels: 3, background: "red" } })
    .webp()
    .toBuffer();
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("player online", () => {
  it("aplica padrões e revisa conteúdo e configuração, não a consulta", async () => {
    const empty = await onlineConfig(config, photos);
    expect(empty.widgets.photos.items).toEqual([]);
    expect(empty.refreshSeconds).toBe(60);
    expect((await onlineConfig(config, photos)).revision).toBe(empty.revision);
    await writeFile(join(photos, "z.webp"), webp);
    await writeFile(join(photos, "a.png"), png);
    await writeFile(join(photos, "b.jpg"), jpeg);
    await writeFile(join(photos, "fake.png"), "not an image");
    await writeFile(join(photos, "other.txt"), png);
    const initial = await onlineConfig(config, photos);
    expect(initial.widgets.photos.items.map((p) => p.alt)).toEqual(["a", "b", "z"]);
    expect(initial.revision).not.toBe(empty.revision);
    expect(initial.widgets.photos.items[0].src).toMatch(
      /^\/api\/player\/online-photos\/[\w-]+\?v=[a-f0-9]{64}$/,
    );
    await writeFile(join(photos, "a.png"), Buffer.concat([png, Buffer.from([2])]));
    const changedPhoto = await onlineConfig(config, photos);
    expect(changedPhoto.revision).not.toBe(initial.revision);
    expect(changedPhoto.widgets.photos.items[0].id).toBe(initial.widgets.photos.items[0].id);
    expect(changedPhoto.widgets.photos.items[0].src).not.toBe(initial.widgets.photos.items[0].src);
    await writeFile(config, JSON.stringify({ widgets: { photos: { intervalSeconds: 30 } } }));
    const changedConfig = await onlineConfig(config, photos);
    expect(changedConfig.widgets.photos.intervalSeconds).toBe(30);
    expect(changedConfig.revision).not.toBe(changedPhoto.revision);
    await rm(join(photos, "b.jpg"));
    expect((await onlineConfig(config, photos)).revision).not.toBe(changedConfig.revision);
  });

  it("rejeita JSON, intervalos, campos e cores inválidos", async () => {
    for (const value of [
      "{",
      JSON.stringify({ refreshSeconds: 0 }),
      JSON.stringify({ widgets: { photos: { intervalSeconds: 3601 } } }),
      JSON.stringify({ widgets: { currencies: { intervalSeconds: 4 } } }),
      JSON.stringify({ widgets: { clock: { color: "url(externo)" } } }),
      JSON.stringify({ photoDirectory: "C:/segredo" }),
    ]) {
      await writeFile(config, value);
      await expect(onlineConfig(config, photos)).rejects.toThrow();
    }
    await writeFile(config, "{}");
  });

  it("bloqueia traversal, conteúdo incompatível, links e arquivos grandes", async () => {
    expect(await readOnlinePhoto(photos, photoId("../secret.png"))).toBeNull();
    expect(await readOnlinePhoto(photos, photoId("..\\secret.png"))).toBeNull();
    expect(await readOnlinePhoto(photos, photoId("fake.png"))).toBeNull();
    expect(await readOnlinePhoto(photos, "!!!")).toBeNull();
    expect((await readOnlinePhoto(photos, photoId("a.png")))?.type).toBe("image/png");
    await writeFile(join(root, "secret.png"), png);
    await link(join(root, "secret.png"), join(photos, "hard.png"));
    expect(await readOnlinePhoto(photos, photoId("hard.png"))).toBeNull();
    try {
      await symlink(join(root, "secret.png"), join(photos, "link.png"));
      expect(await readOnlinePhoto(photos, photoId("link.png"))).toBeNull();
    } catch (error) {
      if (!["EPERM", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
    }
    await writeFile(join(photos, "large.png"), Buffer.alloc(16 * 1024 * 1024 + 1));
    expect(await readOnlinePhoto(photos, photoId("large.png"))).toBeNull();
  });
});

it("exige dispositivo válido e household opt-in, inclusive após revogação", async () => {
  const db = createDatabase(process.env.DATABASE_URL!);
  const userId = randomUUID();
  try {
    const user = await db.user.create({
      data: {
        id: userId,
        name: "Online",
        email: `${userId}@test.local`,
        household: { create: { name: "Casa" } },
      },
      include: { household: true },
    });
    const household = user.household!.id;
    const code = await issuePairingCode(db, household, userId);
    const paired = await redeemPairingCode(db, code.code, "Tablet");
    const bearer = `Bearer ${paired.token}`;
    await expect(checkOnlinePlayer(db, null, household)).rejects.toMatchObject({ status: 401 });
    await expect(checkOnlinePlayer(db, bearer, undefined)).rejects.toMatchObject({ status: 403 });
    await expect(checkOnlinePlayer(db, bearer, "outro")).rejects.toMatchObject({ status: 403 });
    await expect(checkOnlinePlayer(db, bearer, household)).resolves.toBeUndefined();
    await db.device.update({ where: { id: paired.deviceId }, data: { revokedAt: new Date() } });
    await expect(checkOnlinePlayer(db, bearer, household)).rejects.toMatchObject({ status: 401 });
  } finally {
    await db.household.deleteMany({ where: { ownerId: userId } });
    await db.user.deleteMany({ where: { id: userId } });
    await db.$disconnect();
  }
});
