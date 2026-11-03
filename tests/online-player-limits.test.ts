import { mkdir, mkdtemp, rm, stat, utimes, writeFile } from "node:fs/promises";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...original,
    open: vi.fn(original.open),
    lstat: vi.fn(original.lstat),
    realpath: vi.fn(original.realpath),
    readdir: vi.fn(original.readdir),
  };
});

import { onlineConfig, photoId, readOnlinePhoto } from "../apps/web/src/lib/online-player";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64",
);
let root: string;
let photos: string;
let config: string;
let original: typeof import("node:fs/promises");

beforeEach(async () => {
  original = await vi.importActual("node:fs/promises");
  root = await mkdtemp(join(process.env.TEMP ?? tmpdir(), "online-limits-"));
  photos = join(root, "photos");
  config = join(root, "config.json");
  await mkdir(photos);
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.mocked(fs.open).mockImplementation(original.open);
  vi.mocked(fs.lstat).mockImplementation(original.lstat);
  vi.mocked(fs.realpath).mockImplementation(original.realpath);
  vi.mocked(fs.readdir).mockImplementation(original.readdir);
  await rm(root, { recursive: true, force: true });
});

describe("limites e concorrência do player online", () => {
  it("usa ID curto e URL recuperável para nome Unicode longo, sem interpretar o ID como caminho", async () => {
    const name = `${"漢".repeat(129)}.png`;
    const id = photoId(name);
    expect(Buffer.from(name).toString("base64url").length).toBeGreaterThan(512);
    expect(id).toMatch(/^h-[a-f0-9]{64}$/);
    // Also exercise filesystems with a 255-byte filename limit using mocked file metadata.
    const metadata = {
      isFile: () => true,
      isSymbolicLink: () => false,
      nlink: 1,
      size: png.length,
      ino: 1,
      dev: 1,
      mtimeMs: 1,
      ctimeMs: 1,
    };
    vi.mocked(fs.readdir).mockResolvedValue([name] as never);
    vi.mocked(fs.realpath).mockImplementation((async (path: string) => path) as typeof fs.realpath);
    vi.mocked(fs.lstat).mockResolvedValue(metadata as never);
    vi.mocked(fs.open).mockResolvedValue({
      stat: async () => metadata,
      read: async (buffer: Buffer) => {
        png.copy(buffer);
        return { bytesRead: png.length, buffer };
      },
      close: async () => {},
    } as never);
    const item = (await onlineConfig(config, photos)).widgets.photos.items[0];
    expect(item.id).toBe(id);
    expect(item.alt).toBe("漢".repeat(129));
    expect(item.src.length).toBeLessThanOrEqual(512);
    expect((await readOnlinePhoto(photos, id))?.bytes).toEqual(png);
    expect(await readOnlinePhoto(photos, `h-${"0".repeat(64)}`)).toBeNull();
    expect(await readOnlinePhoto(photos, photoId(`../${name}`))).toBeNull();
  });

  it.skipIf(process.platform !== "win32")("lê nome CJK longo real no Windows", async () => {
    const name = `${"漢".repeat(129)}.png`;
    await writeFile(join(photos, name), png);
    const item = (await onlineConfig(config, photos)).widgets.photos.items[0];
    expect(item.id).toBe(photoId(name));
    expect((await readOnlinePhoto(photos, item.id))?.bytes).toEqual(png);
  });

  it.each(["jpeg", "png", "webp"] as const)(
    "valida limites de dimensões de %s na listagem e leitura",
    async (format) => {
      const sizes = [
        [4096, 1, true],
        [1, 4096, true],
        [2048, 1024, true],
        [4097, 1, false],
        [1, 4097, false],
        [2049, 1024, false],
      ] as const;
      for (const [width, height, accepted] of sizes) {
        const name = `${width}x${height}.${format}`;
        const bytes = await sharp({
          create: { width, height, channels: 3, background: "red" },
        })
          .toFormat(format)
          .toBuffer();
        await writeFile(join(photos, name), bytes);
        expect(Boolean(await readOnlinePhoto(photos, photoId(name)))).toBe(accepted);
      }
      const items = (await onlineConfig(config, photos)).widgets.photos.items;
      expect(items.map((item) => item.alt).sort()).toEqual(["1x4096", "2048x1024", "4096x1"]);
    },
  );

  it("rejeita cabeçalhos truncados, dimensões inválidas e extensão incompatível", async () => {
    const zeroHeight = Buffer.from(png);
    zeroHeight.writeUInt32BE(0, 20);
    await writeFile(join(photos, "zero.png"), zeroHeight);
    await writeFile(join(photos, "truncada.png"), png.subarray(0, 16));
    await writeFile(join(photos, "errada.jpg"), png);
    for (const name of ["zero.png", "truncada.png", "errada.jpg"])
      expect(await readOnlinePhoto(photos, photoId(name))).toBeNull();
    expect((await onlineConfig(config, photos)).widgets.photos.items).toEqual([]);
  });

  it.each(["EACCES", "EPERM"])("isola %s por foto e não revela detalhes", async (code) => {
    await writeFile(join(photos, "a.png"), png);
    await writeFile(join(photos, "privada.png"), png);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(fs.open).mockImplementation(((path: string, ...args: unknown[]) => {
      if (basename(path) === "privada.png")
        throw Object.assign(new Error(`segredo ${path}`), { code });
      return original.open(path, ...(args as [number]));
    }) as typeof fs.open);
    const result = await onlineConfig(config, photos);
    expect(result.widgets.photos.items.map((item) => item.alt)).toEqual(["a"]);
    expect(await readOnlinePhoto(photos, photoId("privada.png"))).toBeNull();
    expect(JSON.stringify(warning.mock.calls)).not.toMatch(/privada|segredo|online-limits/);
    expect(warning).toHaveBeenCalled();
    vi.mocked(fs.open).mockImplementation(original.open);
    const recovered = await onlineConfig(config, photos);
    expect(recovered.widgets.photos.items.map((item) => item.alt)).toEqual(["a", "privada"]);
    expect(recovered.revision).not.toBe(result.revision);
  });

  it("não transforma falhas gerais de diretório ou EIO em álbum vazio", async () => {
    vi.mocked(fs.readdir).mockRejectedValueOnce(
      Object.assign(new Error("negado"), { code: "EACCES" }),
    );
    await expect(onlineConfig(config, photos)).rejects.toMatchObject({ code: "EACCES" });
    await writeFile(join(photos, "a.png"), png);
    vi.mocked(fs.open).mockRejectedValueOnce(Object.assign(new Error("falha"), { code: "EIO" }));
    await expect(onlineConfig(config, photos)).rejects.toMatchObject({ code: "EIO" });
  });

  it("compartilha só a varredura ativa e detecta bytes alterados com mtime restaurado", async () => {
    const path = join(photos, "a.png");
    await writeFile(path, png);
    let unblock!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let opens = 0;
    vi.mocked(fs.open).mockImplementation((async (...args: Parameters<typeof fs.open>) => {
      opens++;
      entered();
      await gate;
      return original.open(...args);
    }) as typeof fs.open);
    const first = onlineConfig(config, photos);
    await started;
    const simultaneous = onlineConfig(config, photos);
    expect(simultaneous).toBe(first);
    unblock();
    const initial = await first;
    expect((await simultaneous).revision).toBe(initial.revision);
    expect(opens).toBe(1);
    const old = await stat(path);
    const modified = Buffer.from(png);
    modified[modified.length - 1] ^= 1;
    await writeFile(path, modified);
    await utimes(path, old.atime, old.mtime);
    const changed = await onlineConfig(config, photos);
    expect(changed.revision).not.toBe(initial.revision);
    expect(changed.widgets.photos.items[0].src).not.toBe(initial.widgets.photos.items[0].src);
    expect(opens).toBe(2);
  });

  it("descarta arquivo alterado durante leitura e inclui nova versão na próxima varredura", async () => {
    const path = join(photos, "a.png");
    await writeFile(path, png);
    vi.mocked(fs.open).mockImplementationOnce((async (...args: Parameters<typeof fs.open>) => {
      const handle = await original.open(...args);
      return {
        stat: () => handle.stat(),
        close: () => handle.close(),
        read: async (buffer: Buffer, offset: number, length: number, position: number) => {
          await writeFile(path, Buffer.concat([png, Buffer.from([2])]));
          return handle.read(buffer, offset, length, position);
        },
      };
    }) as typeof fs.open);
    const during = await onlineConfig(config, photos);
    expect(during.widgets.photos.items).toEqual([]);
    const after = await onlineConfig(config, photos);
    expect(after.widgets.photos.items).toHaveLength(1);
    expect(after.revision).not.toBe(during.revision);
  });

  it("rejeita quantidade de candidatos sem truncar e libera a varredura após falha", async () => {
    vi.mocked(fs.readdir).mockResolvedValueOnce(
      Array.from({ length: 4097 }, (_, i) => `${i}.png`) as never,
    );
    await expect(onlineConfig(config, photos)).rejects.toMatchObject({ status: 413 });
    expect((await onlineConfig(config, photos)).widgets.photos.items).toEqual([]);
  });

  it("rejeita JSON UTF-8 acima de 1 MiB sem truncar fotos", async () => {
    const names = Array.from(
      { length: 2400 },
      (_, i) => `${i.toString().padStart(4, "0")}${"é".repeat(90)}.png`,
    );
    const metadata = {
      isFile: () => true,
      isSymbolicLink: () => false,
      nlink: 1,
      size: png.length,
      ino: 1,
      dev: 1,
      mtimeMs: 1,
      ctimeMs: 1,
    };
    vi.mocked(fs.readdir).mockResolvedValue(names as never);
    vi.mocked(fs.realpath).mockImplementation((async (path: string) => path) as typeof fs.realpath);
    vi.mocked(fs.lstat).mockResolvedValue(metadata as never);
    vi.mocked(fs.open).mockResolvedValue({
      stat: async () => metadata,
      read: async (buffer: Buffer) => {
        png.copy(buffer);
        return { bytesRead: png.length, buffer };
      },
      close: async () => {},
    } as never);
    await expect(onlineConfig(config, photos)).rejects.toMatchObject({
      status: 413,
      message: expect.stringContaining("1 MiB"),
    });
  });

  it("limita bytes por varredura e por tempo, mesmo se os arquivos forem inválidos", async () => {
    let now = Date.now() + 120_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const metadata = {
      isFile: () => true,
      isSymbolicLink: () => false,
      nlink: 1,
      size: 16 * 1024 * 1024,
      ino: 1,
      dev: 1,
      mtimeMs: 1,
      ctimeMs: 1,
    };
    vi.mocked(fs.readdir).mockResolvedValue(
      Array.from({ length: 9 }, (_, i) => `${i}.png`) as never,
    );
    vi.mocked(fs.realpath).mockImplementation((async (path: string) => path) as typeof fs.realpath);
    vi.mocked(fs.lstat).mockResolvedValue(metadata as never);
    vi.mocked(fs.open).mockResolvedValue({
      stat: async () => metadata,
      read: async (buffer: Buffer) => ({ bytesRead: 0, buffer }),
      close: async () => {},
    } as never);
    await expect(onlineConfig(config, photos)).rejects.toMatchObject({
      status: 413,
      message: expect.stringContaining("128 MiB"),
    });
    vi.mocked(fs.readdir).mockResolvedValue(
      Array.from({ length: 8 }, (_, i) => `${i}.png`) as never,
    );
    await expect(onlineConfig(config, photos)).resolves.toBeDefined();
    await expect(onlineConfig(config, photos)).rejects.toMatchObject({ status: 429 });
    now += 60_000;
    await expect(onlineConfig(config, photos)).resolves.toBeDefined();
    // A single client at the permitted 10-second minimum must sustain a full album.
    for (let i = 0; i < 10; i++) {
      now += 10_000;
      await expect(onlineConfig(config, photos)).resolves.toBeDefined();
    }
  });
});
