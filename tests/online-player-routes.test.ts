import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import sharp from "sharp";
import { getDatabase } from "@smartframe/database";
import { issuePairingCode, redeemPairingCode } from "@smartframe/frames";

vi.mock("server-only", () => ({}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return { ...original, readdir: vi.fn(original.readdir) };
});
// Player routes never use panel authentication.
vi.mock("../apps/web/src/lib/panel-access", () => ({ panelAccess: vi.fn() }));
vi.mock("@smartframe/widgets", async (original) => ({
  ...(await original<typeof import("@smartframe/widgets")>()),
  onlineWidgetData: vi.fn(async () => ({ refreshSeconds: 1800, weather: null, currencies: {} })),
}));

import { GET as getConfig } from "../apps/web/src/app/api/player/config/route";
import { GET as getPhoto } from "../apps/web/src/app/api/player/online-photos/[id]/route";

const db = getDatabase();
const userId = randomUUID();
let directory: string;
let token: string;
let deviceId: string;
let household: string;

beforeAll(async () => {
  directory = await mkdtemp(join(process.env.TEMP ?? tmpdir(), "smartframe-online-routes-"));
  await mkdir(join(directory, "photos"));
  await writeFile(
    join(directory, "photos", "casa.png"),
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  process.env.SMARTFRAME_ONLINE_CONFIG = join(directory, "config.json");
  process.env.SMARTFRAME_ONLINE_PHOTOS = join(directory, "photos");
  const user = await db.user.create({
    data: {
      id: userId,
      name: "Online",
      email: `${userId}@test.local`,
      household: { create: { name: "Casa" } },
    },
    include: { household: true },
  });
  household = user.household!.id;
  process.env.SMARTFRAME_ONLINE_HOUSEHOLD_ID = household;
  const code = await issuePairingCode(db, household, userId);
  const paired = await redeemPairingCode(db, code.code, "Tablet");
  token = paired.token;
  deviceId = paired.deviceId;
});

afterAll(async () => {
  delete process.env.SMARTFRAME_ONLINE_CONFIG;
  delete process.env.SMARTFRAME_ONLINE_PHOTOS;
  delete process.env.SMARTFRAME_ONLINE_HOUSEHOLD_ID;
  await db.household.deleteMany({ where: { ownerId: userId } });
  await db.user.deleteMany({ where: { id: userId } });
  await db.$disconnect();
  await rm(directory, { recursive: true, force: true });
});

it("protege configuração e imagem HTTP, inclusive depois da revogação", async () => {
  const request = (path: string, credential = token) =>
    new Request(`https://example.test${path}`, {
      headers: credential ? { authorization: `Bearer ${credential}` } : {},
    });
  expect((await getConfig(request("/api/player/config", ""))).status).toBe(401);
  const response = await getConfig(request("/api/player/config"));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  const body = await response.json();
  expect(body.widgetData.refreshSeconds).toBe(1800);
  const photoUrl = body.widgets.photos.items[0].src as string;
  const id = body.widgets.photos.items[0].id as string;
  const context = { params: Promise.resolve({ id }) };
  expect((await getPhoto(request(photoUrl, ""), context)).status).toBe(401);
  const photo = await getPhoto(request(photoUrl), context);
  expect(photo.status).toBe(200);
  expect(photo.headers.get("content-type")).toBe("image/png");
  expect(photo.headers.get("x-content-type-options")).toBe("nosniff");
  expect(photo.headers.get("cache-control")).toBe("private, no-store");
  const oversized = await sharp({
    create: { width: 4097, height: 1, channels: 3, background: "red" },
  })
    .png()
    .toBuffer();
  await writeFile(join(directory, "photos", "casa.png"), oversized);
  expect((await getPhoto(request(photoUrl), context)).status).toBe(404);
  const withoutOversized = await (await getConfig(request("/api/player/config"))).json();
  expect(withoutOversized.widgets.photos.items).toEqual([]);
  if (process.platform === "win32") {
    const name = `${"漢".repeat(129)}.png`;
    await writeFile(
      join(directory, "photos", name),
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
        "base64",
      ),
    );
    const unicodeConfig = await (await getConfig(request("/api/player/config"))).json();
    const item = unicodeConfig.widgets.photos.items[0];
    expect(item.src.length).toBeLessThanOrEqual(512);
    expect(
      (await getPhoto(request(item.src), { params: Promise.resolve({ id: item.id }) })).status,
    ).toBe(200);
  }
  expect(Buffer.byteLength(JSON.stringify(body), "utf8")).toBeLessThanOrEqual(1024 * 1024);
  vi.mocked(fs.readdir).mockResolvedValueOnce(
    Array.from({ length: 4097 }, (_, i) => `${i}.png`) as never,
  );
  const tooLarge = await getConfig(request("/api/player/config"));
  expect(tooLarge.status).toBe(413);
  expect(tooLarge.headers.get("cache-control")).toBe("private, no-store");
  const error = await tooLarge.text();
  expect(error).toContain("4096");
  expect(error).not.toContain(directory);
  expect(
    (await getPhoto(request(photoUrl), { params: Promise.resolve({ id: "Li4vc2VjcmV0LnBuZw" }) }))
      .status,
  ).toBe(404);
  await writeFile(join(directory, "config.json"), JSON.stringify({ refreshSeconds: 0 }));
  const invalid = await getConfig(request("/api/player/config"));
  expect(invalid.status).toBe(400);
  expect(await invalid.text()).not.toContain(directory);
  process.env.SMARTFRAME_ONLINE_HOUSEHOLD_ID = "other";
  expect((await getConfig(request("/api/player/config"))).status).toBe(403);
  expect((await getPhoto(request(photoUrl), context)).status).toBe(403);
  process.env.SMARTFRAME_ONLINE_HOUSEHOLD_ID = household;
  await db.device.update({ where: { id: deviceId }, data: { revokedAt: new Date() } });
  expect((await getConfig(request("/api/player/config"))).status).toBe(401);
  expect((await getPhoto(request(photoUrl), context)).status).toBe(401);
});
