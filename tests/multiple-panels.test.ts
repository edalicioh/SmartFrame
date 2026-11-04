import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { getDatabase } from "@smartframe/database";
import { issuePairingCode, redeemPairingCode } from "@smartframe/frames";

vi.mock("server-only", () => ({}));
const panelAccess = vi.hoisted(() => vi.fn());
vi.mock("../apps/web/src/lib/panel-access", () => ({ panelAccess }));
vi.mock("@smartframe/widgets", async (original) => ({
  ...(await original<typeof import("@smartframe/widgets")>()),
  onlineWidgetData: vi.fn(async () => ({ refreshSeconds: 1800, weather: null, currencies: {} })),
}));

import { GET, POST, PUT, PATCH, DELETE } from "../apps/web/src/app/api/panels/route";
import { POST as publish } from "../apps/web/src/app/api/panels/publish/route";
import { GET as playerConfig } from "../apps/web/src/app/api/player/config/route";
import { GET as playerMedia } from "../apps/web/src/app/api/player/online-media/[id]/route";

const db = getDatabase();
const userId = randomUUID();
let householdId: string;
let first: { deviceId: string; token: string };
let second: { deviceId: string; token: string };
const request = (method: string, body?: unknown, path = "/api/panels") =>
  new Request(`https://example.test${path}`, {
    method,
    headers: {
      origin: "https://example.test",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
const player = (token: string) =>
  playerConfig(
    new Request("https://example.test/api/player/config", {
      headers: { authorization: `Bearer ${token}` },
    }),
  );

beforeAll(async () => {
  process.env.BETTER_AUTH_URL = "https://example.test";
  const user = await db.user.create({
    data: {
      id: userId,
      name: "Test",
      email: `${userId}@test.local`,
      household: { create: { name: "Casa" } },
    },
    include: { household: true },
  });
  householdId = user.household!.id;
  panelAccess.mockResolvedValue({ household: { id: householdId }, user: { id: userId } });
  const pair = async (name: string) => {
    const code = await issuePairingCode(db, householdId, userId);
    return redeemPairingCode(db, code.code, name);
  };
  first = await pair("Tablet 1");
  second = await pair("Tablet 2");
});
afterAll(async () => {
  await db.household.deleteMany({ where: { ownerId: userId } });
  await db.user.deleteMany({ where: { id: userId } });
  await db.$disconnect();
});

it("preserves existing drafts, published versions, credentials and applied revisions in migration", () => {
  const sqlite = new DatabaseSync(":memory:");
  try {
    sqlite.exec(`CREATE TABLE Device (id TEXT PRIMARY KEY, householdId TEXT, tokenHash TEXT, appliedRevision TEXT);
      CREATE TABLE Layout (id TEXT PRIMARY KEY, householdId TEXT, key TEXT, draft TEXT, publishedVersionId TEXT);
      CREATE TABLE LayoutVersion (id TEXT PRIMARY KEY, layoutId TEXT, config TEXT);
      INSERT INTO Device VALUES ('d', 'h', 'secret-hash', 'online:v');
      INSERT INTO Layout VALUES ('l', 'h', 'online:d', '{"refreshSeconds":30}', 'v');
      INSERT INTO LayoutVersion VALUES ('v', 'l', '{"refreshSeconds":20}');`);
    sqlite.exec(
      readFileSync(
        "packages/database/prisma/migrations/20261103120000_multiple_online_panels/migration.sql",
        "utf8",
      ),
    );
    expect(
      sqlite
        .prepare(
          "SELECT activePanelId, activePanelVersionId, tokenHash, appliedRevision FROM Device",
        )
        .get(),
    ).toEqual({
      activePanelId: "l",
      activePanelVersionId: "v",
      tokenHash: "secret-hash",
      appliedRevision: "online:v",
    });
    expect(sqlite.prepare("SELECT draft FROM Layout WHERE id = 'l'").get()?.draft).toBe(
      '{"refreshSeconds":30}',
    );
    expect(sqlite.prepare("SELECT config FROM LayoutVersion WHERE id = 'v'").get()?.config).toBe(
      '{"refreshSeconds":20}',
    );
  } finally {
    sqlite.close();
  }
});

it("manages independent drafts and publishes immutable versions to selected devices", async () => {
  const create = await POST(request("POST", { name: "Casa" }));
  expect(create.status).toBe(201);
  const a = (await create.json()).id;
  const copied = await POST(request("POST", { name: "Trabalho", copyFromId: a }));
  const b = (await copied.json()).id;
  expect((await GET(request("GET"))).status).toBe(200);
  expect((await PATCH(request("PATCH", { id: b, name: "Escritório" }))).status).toBe(200);
  expect(
    (await PUT(request("PUT", { id: a, expectedRevision: 1, config: { refreshSeconds: 20 } })))
      .status,
  ).toBe(200);
  expect((await PUT(request("PUT", { id: a, expectedRevision: 1, config: {} }))).status).toBe(409);
  expect(
    (await (await GET(request("GET", undefined, `?id=${b}`))).json()).config.refreshSeconds,
  ).toBe(15);
  const send = (panelId: string, deviceId: string, expectedRevision: number) =>
    publish(request("POST", { panelId, deviceId, expectedRevision }, "/api/panels/publish"));
  const firstPublication = await send(a, first.deviceId, 2);
  expect(firstPublication.status).toBe(200);
  const firstRevision = (await firstPublication.json()).revision;
  expect((await send(a, second.deviceId, 2)).status).toBe(200);
  expect(
    (await PUT(request("PUT", { id: a, expectedRevision: 2, config: { refreshSeconds: 30 } })))
      .status,
  ).toBe(200);
  expect((await (await player(first.token)).json()).refreshSeconds).toBe(20);
  expect((await send(a, first.deviceId, 3)).status).toBe(200);
  expect((await (await player(first.token)).json()).refreshSeconds).toBe(30);
  const ack = (revision: string) =>
    playerConfig(
      new Request(
        `https://example.test/api/player/config?appliedRevision=${encodeURIComponent(revision)}`,
        { headers: { authorization: `Bearer ${first.token}` } },
      ),
    );
  await ack(firstRevision);
  expect(
    (await db.device.findUniqueOrThrow({ where: { id: first.deviceId } })).appliedRevision,
  ).toBeNull();
  const currentRevision = (await (await player(first.token)).json()).revision;
  await ack(currentRevision);
  expect(
    (await db.device.findUniqueOrThrow({ where: { id: first.deviceId } })).appliedRevision,
  ).toBe(currentRevision);
  expect((await (await player(second.token)).json()).refreshSeconds).toBe(20);
  expect((await DELETE(request("DELETE", { id: a }))).status).toBe(409);
  expect((await send(b, first.deviceId, 1)).status).toBe(200);
  expect((await send(b, second.deviceId, 1)).status).toBe(200);
  expect((await DELETE(request("DELETE", { id: a }))).status).toBe(200);
  expect((await (await player(first.token)).json()).refreshSeconds).toBe(15);
  expect((await send(b, first.deviceId, 99)).status).toBe(409);
  expect(
    (
      await PUT(
        request("PUT", {
          id: b,
          expectedRevision: 1,
          config: { widgets: { photos: { photoIds: [randomUUID()] } } },
        }),
      )
    ).status,
  ).toBe(200);
  expect((await send(b, first.deviceId, 2)).status).toBe(400);
  expect((await (await player(first.token)).json()).refreshSeconds).toBe(15);
});

it("rejects unauthenticated, cross-origin and cross-household operations", async () => {
  const created = await POST(request("POST", { name: "Privado" }));
  const id = (await created.json()).id;
  const foreignUser = randomUUID();
  const foreign = await db.user.create({
    data: {
      id: foreignUser,
      name: "Outro",
      email: `${foreignUser}@test.local`,
      household: { create: { name: "Outra casa" } },
    },
    include: { household: true },
  });
  try {
    panelAccess.mockResolvedValueOnce(null);
    expect((await GET(request("GET"))).status).toBe(401);
    const wrongOrigin = new Request("https://example.test/api/panels", {
      method: "POST",
      headers: { origin: "https://other.test", "content-type": "application/json" },
      body: JSON.stringify({ name: "Inválido" }),
    });
    expect((await POST(wrongOrigin)).status).toBe(403);
    panelAccess.mockResolvedValue({
      household: { id: foreign.household!.id },
      user: { id: foreignUser },
    });
    expect((await GET(request("GET", undefined, `?id=${id}`))).status).toBe(404);
    expect((await POST(request("POST", { name: "Cópia", copyFromId: id }))).status).toBe(404);
    expect((await DELETE(request("DELETE", { id }))).status).toBe(404);
    expect(
      (
        await publish(
          request("POST", { panelId: id, deviceId: first.deviceId, expectedRevision: 1 }),
        )
      ).status,
    ).toBe(404);
  } finally {
    panelAccess.mockResolvedValue({ household: { id: householdId }, user: { id: userId } });
    await db.household.deleteMany({ where: { ownerId: foreignUser } });
    await db.user.deleteMany({ where: { id: foreignUser } });
  }
});

it("does not expose photos from a panel assigned to a different device", async () => {
  const photo = await db.media.create({
    data: {
      householdId,
      filename: "privada.webp",
      status: "ready",
      sha256: "abc",
      bytes: 10,
      width: 10,
      height: 10,
    },
  });
  const create = await POST(request("POST", { name: "Com foto" }));
  const id = (await create.json()).id;
  expect(
    (
      await PUT(
        request("PUT", {
          id,
          expectedRevision: 1,
          config: { widgets: { photos: { photoIds: [photo.id] } } },
        }),
      )
    ).status,
  ).toBe(200);
  expect(
    (await publish(request("POST", { panelId: id, deviceId: first.deviceId, expectedRevision: 2 })))
      .status,
  ).toBe(200);
  const response = await playerMedia(
    new Request(`https://example.test/api/player/online-media/${photo.id}`, {
      headers: { authorization: `Bearer ${second.token}` },
    }),
    { params: Promise.resolve({ id: photo.id }) },
  );
  expect(response.status).toBe(404);
  expect((await (await player(first.token)).json()).widgets.photos.items[0].id).toBe(photo.id);
});
