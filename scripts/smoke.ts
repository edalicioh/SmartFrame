import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { request as httpRequest } from "node:http";
import { resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import { createDatabase } from "@smartframe/database";
import { bootstrapAdministrator } from "@smartframe/auth/bootstrap";
import { optimizeBackground } from "@smartframe/frames";
import sharp from "sharp";

// O banco do usuário e suas credenciais nunca são usados neste teste.
const noLogin = process.argv.includes("--no-login");
await mkdir(".data", { recursive: true });
const filename = resolve(".data", `smoke-${randomUUID()}.db`);
const storage = resolve(".data", `smoke-media-${randomUUID()}`);
process.env.STORAGE_PATH = storage;
const listener = createServer();
await new Promise<void>((done) => listener.listen(0, "127.0.0.1", done));
const address = listener.address();
assert(address && typeof address === "object");
const port = address.port;
await new Promise<void>((done, reject) =>
  listener.close((error) => (error ? reject(error) : done())),
);
const baseURL = `http://127.0.0.1:${port}`;
const environment = {
  ...process.env,
  NODE_ENV: "production",
  NEXT_TELEMETRY_DISABLED: "1",
  DATABASE_URL: `file:${filename}`,
  STORAGE_PATH: storage,
  BETTER_AUTH_URL: baseURL,
  BETTER_AUTH_SECRET: randomBytes(48).toString("base64url"),
  SMARTFRAME_ADMIN_LOGIN: noLogin ? "disabled" : "required",
  SMARTFRAME_ADMIN_EMAIL: noLogin ? "smoke@smartframe.test" : "",
  SMARTFRAME_ONLINE_HOUSEHOLD_ID: "",
  SMARTFRAME_ONLINE_CONFIG: resolve(storage, "online-config.json"),
  SMARTFRAME_ONLINE_PHOTOS: resolve(storage, "online-photos"),
};
execFileSync(
  process.execPath,
  [resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"],
  { env: environment, stdio: "pipe" },
);
const database = createDatabase(environment.DATABASE_URL);
const password = randomBytes(24).toString("base64url");
let server: ReturnType<typeof spawn> | undefined;
let output = "";

try {
  const administrator = await bootstrapAdministrator(database, {
    name: "Smoke Test",
    email: "smoke@smartframe.test",
    password,
  });
  const household = await database.household.findUniqueOrThrow({
    where: { ownerId: administrator.id },
  });
  environment.SMARTFRAME_ONLINE_HOUSEHOLD_ID = household.id;
  await mkdir(environment.SMARTFRAME_ONLINE_PHOTOS, { recursive: true });
  const onlinePhoto = await sharp({
    create: { width: 12, height: 8, channels: 3, background: "#2563eb" },
  })
    .png()
    .toBuffer();
  await writeFile(resolve(environment.SMARTFRAME_ONLINE_PHOTOS, "foto.png"), onlinePhoto);
  await writeFile(
    environment.SMARTFRAME_ONLINE_CONFIG,
    JSON.stringify({ widgets: { photos: { intervalSeconds: 15 } } }),
  );
  await database.device.create({
    data: {
      householdId: household.id,
      name: "Tablet autorizado",
      tokenHash: "hash-que-nao-pode-ser-exposto",
    },
  });
  await database.device.create({
    data: { householdId: household.id, name: "Tablet revogado", revokedAt: new Date() },
  });
  const other = await database.user.create({
    data: {
      id: randomUUID(),
      name: "Outra conta",
      email: "other@smartframe.test",
      household: { create: { name: "Outra casa" } },
    },
    include: { household: true },
  });
  await database.device.create({
    data: { householdId: other.household!.id, name: "Tablet privado de outra conta" },
  });

  server = spawn(
    process.execPath,
    [
      resolve("node_modules/next/dist/bin/next"),
      "start",
      "apps/web",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    {
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  server.stdout?.on("data", (data) => {
    output += String(data);
  });
  server.stderr?.on("data", (data) => {
    output += String(data);
  });
  let healthy = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (server.exitCode !== null) throw new Error("Servidor encerrou antes de iniciar.");
    try {
      healthy = (await fetch(`${baseURL}/api/health`)).ok;
    } catch {
      /* aguarda inicialização */
    }
    if (healthy) break;
    await setTimeout(500);
  }
  assert(healthy, "API de saúde deve responder após a inicialização");
  const onlinePlayer = await fetch(`${baseURL}/player-dashboard/index.html`, {
    redirect: "manual",
  });
  assert.equal(onlinePlayer.status, 200, "HTML online deve abrir sem redirecionamento no Android");
  assert.match(onlinePlayer.headers.get("content-type") ?? "", /text\/html/);
  const onlineDirectory = await fetch(`${baseURL}/player-dashboard/`);
  assert.equal(onlineDirectory.status, 200, "endereço público do dashboard deve abrir");
  assert.equal(new URL(onlineDirectory.url).pathname, "/player-dashboard/index.html");
  assert.equal((await fetch(`${baseURL}/player-dashboard/js/app.js`)).status, 200);
  assert.equal((await fetch(`${baseURL}/api/player/config`)).status, 401);
  const anonymous = await fetch(`${baseURL}/`, { redirect: "manual" });
  let cookie = "";
  if (noLogin) {
    assert.equal(anonymous.status, 200);
    assert.equal((await fetch(`${baseURL}/login`, { redirect: "manual" })).status, 307);
    assert.equal((await fetch(`${baseURL}/api/devices`)).status, 200);
    const hostileStatus = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(
        `${baseURL}/api/frame`,
        { headers: { Host: "host-externo.test" } },
        (response) => {
          response.resume();
          resolve(response.statusCode ?? 0);
        },
      );
      request.on("error", reject);
      request.end();
    });
    assert.equal(hostileStatus, 403);
  } else {
    assert.equal(anonymous.status, 307);
    assert.equal(new URL(anonymous.headers.get("location")!, baseURL).pathname, "/login");
    assert.equal((await fetch(`${baseURL}/api/devices`)).status, 401);
    const loginPage = await fetch(`${baseURL}/login`);
    assert.equal(loginPage.status, 200);
    assert((await loginPage.text()).includes("Que bom ter"));
    const signin = await fetch(`${baseURL}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseURL },
      body: JSON.stringify({ email: administrator.email, password }),
    });
    assert.equal(signin.status, 200);
    const cookies = signin.headers.getSetCookie();
    assert(cookies.some((value) => /httponly/i.test(value)));
    cookie = cookies.map((value) => value.split(";")[0]).join("; ");
  }
  const deviceResponse = await fetch(`${baseURL}/api/devices`, { headers: { cookie } });
  assert.equal(deviceResponse.status, 200);
  assert(deviceResponse.headers.get("cache-control")?.includes("no-store"));
  const data = await deviceResponse.json();
  assert.equal(data.data.length, 1);
  assert.equal(data.data[0].name, "Tablet autorizado");
  assert(!JSON.stringify(data).includes("tokenHash"));
  assert(!JSON.stringify(data).includes("Outra conta"));
  const dashboard = await fetch(`${baseURL}/`, { headers: { cookie } });
  assert.equal(dashboard.status, 200);
  const html = await dashboard.text();
  assert(html.includes("Smoke"));
  assert(html.includes("Seus porta-retratos"));
  if (noLogin) assert(!html.includes("Sair da conta"));

  const adminHeaders = { cookie, Origin: baseURL, "Content-Type": "application/json" };
  assert.equal((await fetch(`${baseURL}/api/frame`)).status, noLogin ? 200 : 401);
  assert.equal(
    (
      await fetch(`${baseURL}/api/frame`, {
        method: "PUT",
        headers: {
          cookie,
          Origin: "https://origem-externa.test",
          "Content-Type": "application/json",
        },
        body: "{}",
      })
    ).status,
    403,
  );
  assert.equal(
    (await fetch(`${baseURL}/api/player/manifest`, { headers: { cookie } })).status,
    401,
  );
  const editor = await fetch(`${baseURL}/layouts`, { headers: { cookie } });
  assert.equal(editor.status, 200);
  assert((await editor.text()).includes("Personalize seu porta-retratos"));
  const preview = await fetch(`${baseURL}/player/index.html`);
  assert.equal(preview.headers.get("x-frame-options"), "SAMEORIGIN");
  const state = await (await fetch(`${baseURL}/api/frame`, { headers: { cookie } })).json();
  const image = await sharp({
    create: { width: 1024, height: 600, channels: 3, background: "#456c56" },
  })
    .png()
    .toBuffer();
  const form = new FormData();
  form.set("photo", new File([new Uint8Array(image)], "foto-smoke.png", { type: "image/png" }));
  const upload = await fetch(`${baseURL}/api/photos`, {
    method: "POST",
    headers: { cookie, Origin: baseURL },
    body: form,
  });
  assert.equal(upload.status, 202);
  const photo = await upload.json();
  await optimizeBackground(database, `background:${photo.id}`);
  const config = {
    ...state.config,
    caption: "Publicado no teste HTTP",
    background: { ...state.config.background, photoId: photo.id },
    widgets: {
      ...state.config.widgets,
      weather: { ...state.config.widgets.weather, enabled: true },
      currencies: { enabled: true },
    },
  };
  const updatedAt = new Date();
  const expiresAt = new Date(updatedAt.getTime() + 600_000);
  await database.widgetSnapshot.createMany({
    data: [
      {
        key: `weather:${config.widgets.weather.latitude.toFixed(4)}:${config.widgets.weather.longitude.toFixed(4)}:${config.timezone}`,
        payload: { temperature: 22.1, minimum: 16.3, maximum: 23.9, weatherCode: 2 },
        updatedAt,
        expiresAt,
      },
      {
        key: "currencies:fiat",
        payload: { usdBrl: 5.4, eurBrl: 6, date: "2026-10-30" },
        updatedAt,
        expiresAt,
      },
      { key: "currencies:btc", payload: { btcUsd: 77003.37 }, updatedAt, expiresAt },
    ],
  });
  const widgetPreview = await fetch(`${baseURL}/api/widgets/preview`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ config }),
  });
  assert.equal(widgetPreview.status, 200);
  assert.equal((await widgetPreview.json()).currencies.btcUsd, 77003.37);
  const saved = await fetch(`${baseURL}/api/frame`, {
    method: "PUT",
    headers: adminHeaders,
    body: JSON.stringify({ config, expectedRevision: 0 }),
  });
  assert.equal(saved.status, 200);
  const savedData = await saved.json();
  const publishedResponse = await fetch(`${baseURL}/api/frame/publish`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ expectedRevision: savedData.draftRevision }),
  });
  assert.equal(publishedResponse.status, 200);
  const published = await publishedResponse.json();
  const changed = await fetch(`${baseURL}/api/frame`, {
    method: "PUT",
    headers: adminHeaders,
    body: JSON.stringify({
      config: { ...config, caption: "Somente rascunho" },
      expectedRevision: 1,
    }),
  });
  assert.equal(changed.status, 200);
  const pairingResponse = await fetch(`${baseURL}/api/devices/pairing-code`, {
    method: "POST",
    headers: adminHeaders,
  });
  assert.equal(pairingResponse.status, 200);
  const pairing = await pairingResponse.json();
  const redeemResponse = await fetch(`${baseURL}/api/player/pair`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: pairing.code, name: "Player HTTP" }),
  });
  assert.equal(redeemResponse.status, 200);
  const connection = await redeemResponse.json();
  const playerHeaders = { Authorization: `Bearer ${connection.token}` };
  const onlineConfigResponse = await fetch(`${baseURL}/api/player/config`, {
    headers: playerHeaders,
  });
  assert.equal(onlineConfigResponse.status, 200);
  const onlineConfig = await onlineConfigResponse.json();
  assert.equal(onlineConfig.widgets.photos.intervalSeconds, 15);
  assert.equal(onlineConfig.widgets.photos.items.length, 1);
  const photoUrl = `${baseURL}${onlineConfig.widgets.photos.items[0].src}`;
  assert.equal((await fetch(photoUrl)).status, 401);
  const onlinePhotoResponse = await fetch(photoUrl, { headers: playerHeaders });
  assert.equal(onlinePhotoResponse.status, 200);
  assert.deepEqual(Buffer.from(await onlinePhotoResponse.arrayBuffer()), onlinePhoto);
  await writeFile(
    environment.SMARTFRAME_ONLINE_CONFIG,
    JSON.stringify({ widgets: { photos: { intervalSeconds: 25 } } }),
  );
  const changedOnline = await (
    await fetch(`${baseURL}/api/player/config`, { headers: playerHeaders })
  ).json();
  assert.equal(changedOnline.widgets.photos.intervalSeconds, 25);
  assert.notEqual(changedOnline.revision, onlineConfig.revision);
  const manifestResponse = await fetch(`${baseURL}/api/player/manifest`, {
    headers: playerHeaders,
  });
  assert.equal(manifestResponse.status, 200);
  const manifest = await manifestResponse.json();
  assert.equal(manifest.widgetData.weather.temperature, 22.1);
  assert.equal(manifest.widgetData.currencies.usdBrl, 5.4);
  assert.equal(manifest.layout.photoFrame.caption, "Publicado no teste HTTP");
  assert.equal(manifest.revision, published.revision);
  const downloaded = await fetch(baseURL + manifest.media[0].path, { headers: playerHeaders });
  assert.equal(downloaded.status, 200);
  assert.equal(
    createHash("sha256")
      .update(Buffer.from(await downloaded.arrayBuffer()))
      .digest("hex"),
    manifest.media[0].sha256,
  );
  assert.equal(
    (await fetch(`${baseURL}/api/player/media/nao-autorizada`, { headers: playerHeaders })).status,
    404,
  );
  const heartbeat = await fetch(`${baseURL}/api/player/heartbeat`, {
    method: "POST",
    headers: { ...playerHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ revision: manifest.revision }),
  });
  assert.equal(heartbeat.status, 200);
  assert.equal(
    (await database.device.findUniqueOrThrow({ where: { id: connection.deviceId } }))
      .appliedRevision,
    published.revision,
  );
  assert.equal(
    (
      await fetch(`${baseURL}/api/devices/${connection.deviceId}`, {
        method: "DELETE",
        headers: adminHeaders,
      })
    ).status,
    200,
  );
  assert.equal(
    (await fetch(`${baseURL}/api/player/manifest`, { headers: playerHeaders })).status,
    401,
  );
  assert.equal(
    (await fetch(`${baseURL}/api/player/config`, { headers: playerHeaders })).status,
    401,
  );
  assert.equal((await fetch(photoUrl, { headers: playerHeaders })).status, 401);

  const forbidden = await fetch(`${baseURL}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://origem-externa.test" },
    body: JSON.stringify({ email: administrator.email, password }),
  });
  assert.equal(forbidden.status, noLogin ? 404 : 403);
  const signup = await fetch(`${baseURL}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseURL },
    body: JSON.stringify({ name: "Cadastro público", email: "public@smartframe.test", password }),
  });
  assert(signup.status >= 400);
  const logout = await fetch(`${baseURL}/api/auth/sign-out`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseURL, cookie },
    body: "{}",
  });
  assert.equal(logout.status, noLogin ? 404 : 200);
  assert.equal(
    (await fetch(`${baseURL}/api/devices`, { headers: { cookie } })).status,
    noLogin ? 200 : 401,
  );
  console.log(
    `Smoke OK (${noLogin ? "painel local sem login" : "login obrigatório"}): isolamento, editor, publicação, pareamento, dashboard online autenticado, troca de intervalo, manifesto, hash, heartbeat e revogação.`,
  );
} catch (error) {
  // Não imprimir corpos de autenticação ou variáveis de ambiente.
  console.error(output);
  throw error;
} finally {
  if (server && server.exitCode === null) {
    const closed = new Promise<void>((done) => server!.once("exit", () => done()));
    server.kill("SIGTERM");
    await closed;
  }
  await database.$disconnect();
  for (const suffix of ["", "-wal", "-shm"]) await rm(`${filename}${suffix}`, { force: true });
  await rm(storage, { recursive: true, force: true });
}
