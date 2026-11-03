import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { getDatabase } from "@smartframe/database";
import { issuePairingCode, redeemPairingCode } from "@smartframe/frames";

vi.mock("server-only", () => ({}));
const panelAccess = vi.hoisted(() => vi.fn());
vi.mock("../apps/web/src/lib/panel-access", () => ({ panelAccess }));
vi.mock("@smartframe/widgets", async (original) => ({ ...(await original<typeof import("@smartframe/widgets")>()), onlineWidgetData: vi.fn(async () => ({ refreshSeconds: 1800, weather: null, currencies: {} })) }));

import { GET as getConfig } from "../apps/web/src/app/api/player/config/route";
import { GET as getDashboard } from "../apps/web/src/app/player/[deviceId]/route";
import { GET as getOnlineFrame, PUT as putOnlineFrame } from "../apps/web/src/app/api/online-frame/route";
import { POST as publishOnlineFrame } from "../apps/web/src/app/api/online-frame/publish/route";

const db = getDatabase();
const userId = randomUUID();
let householdId: string;
let deviceId: string;
let token: string;
const adminRequest = (url: string, body?: unknown) => new Request(`https://example.test${url}`, { method: body ? "PUT" : "GET", headers: { origin: "https://example.test", ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });

beforeAll(async () => {
  process.env.BETTER_AUTH_URL = "https://example.test";
  const user = await db.user.create({ data: { id: userId, name: "Online", email: `${userId}@test.local`, household: { create: { name: "Casa" } } }, include: { household: true } });
  householdId = user.household!.id;
  panelAccess.mockResolvedValue({ household: { id: householdId }, user: { id: userId } });
  const pairing = await issuePairingCode(db, householdId, userId);
  const paired = await redeemPairingCode(db, pairing.code, "Tablet");
  deviceId = paired.deviceId;
  token = paired.token;
});
afterAll(async () => { await db.household.deleteMany({ where: { ownerId: userId } }); await db.user.deleteMany({ where: { id: userId } }); await db.$disconnect(); });

it("serves canonical dashboard HTML by safe device path without caching or credentials", async () => {
  const response = await getDashboard(new Request(`https://example.test/player/${deviceId}`), { params: Promise.resolve({ deviceId }) });
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-frame-options")).toBe("SAMEORIGIN");
  const html = await response.text();
  expect(html).toContain("/player-dashboard/player.js");
  expect(html).toContain("/player-dashboard/player.css");
  expect(html).not.toContain(token);
  const invalidId = "../secret";
  expect((await getDashboard(new Request("https://example.test/player/../secret"), { params: Promise.resolve({ deviceId: invalidId }) })).status).toBe(404);
});

it("uses only a device's published version and never acknowledges merely delivered config", async () => {
  const authRequest = (query = "") => new Request(`https://example.test/api/player/config${query}`, { headers: { authorization: `Bearer ${token}` } });
  expect((await getConfig(authRequest("?deviceId=wrong"))).status).toBe(403);
  expect((await getConfig(authRequest())).status).toBe(409);
  const device = await db.device.findUniqueOrThrow({ where: { id: deviceId } });
  expect(device.appliedRevision).toBeNull();
  const put = await putOnlineFrame(adminRequest("/api/online-frame", { deviceId, config: { refreshSeconds: 20 }, expectedRevision: 0 }));
  expect(put.status).toBe(200);
  expect((await publishOnlineFrame(new Request("https://example.test/api/online-frame/publish", { method: "POST", headers: { origin: "https://example.test", "content-type": "application/json" }, body: JSON.stringify({ deviceId, expectedRevision: 1 }) }))).status).toBe(200);
  const delivered = await getConfig(authRequest());
  expect(delivered.status).toBe(200);
  expect((await delivered.json()).refreshSeconds).toBe(20);
  expect((await db.device.findUniqueOrThrow({ where: { id: deviceId } })).appliedRevision).toBeNull();
  const state = await (await getOnlineFrame(new Request(`https://example.test/api/online-frame?deviceId=${deviceId}`))).json();
  expect(state.publishedRevision).toMatch(/^online:/);
  expect(state.config.refreshSeconds).toBe(20);
});

it("rejects stale draft writes and impossible media selections", async () => {
  const put = (config: unknown, expectedRevision: number) => putOnlineFrame(adminRequest("/api/online-frame", { deviceId, config, expectedRevision }));
  expect((await put({ refreshSeconds: 30 }, 1)).status).toBe(200);
  expect((await put({ refreshSeconds: 40 }, 1)).status).toBe(409);
  expect((await publishOnlineFrame(new Request("https://example.test/api/online-frame/publish", { method: "POST", headers: { origin: "https://example.test", "content-type": "application/json" }, body: JSON.stringify({ deviceId, expectedRevision: 2 }) }))).status).toBe(200);
  expect((await put({ widgets: { photos: { photoIds: [randomUUID()] } }, refreshSeconds: 40 }, 2)).status).toBe(200);
  const rejected = await publishOnlineFrame(new Request("https://example.test/api/online-frame/publish", { method: "POST", headers: { origin: "https://example.test", "content-type": "application/json" }, body: JSON.stringify({ deviceId, expectedRevision: 3 }) }));
  expect(rejected.status).toBe(400);
});
