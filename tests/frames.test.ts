import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { createDatabase } from "@smartframe/database";
import { defaultPhotoFrame, photoFrameSchema } from "@smartframe/contracts";
import {
  acknowledgeFrame,
  authorizePlayer,
  frameState,
  issuePairingCode,
  limitPairing,
  optimizeBackground,
  playerManifest,
  publishFrame,
  readBackground,
  redeemPairingCode,
  saveFrame,
  uploadBackground,
} from "@smartframe/frames";

const db = createDatabase(process.env.DATABASE_URL!);
const users = [randomUUID(), randomUUID()];
let owner: string;
let other: string;
let token: string;
let deviceId: string;
let revision: string;
let photoId: string;

beforeAll(async () => {
  const first = await db.user.create({
    data: {
      id: users[0],
      name: "Editor",
      email: `${users[0]}@test.local`,
      household: { create: { name: "Casa A" } },
    },
    include: { household: true },
  });
  const second = await db.user.create({
    data: {
      id: users[1],
      name: "Outra conta",
      email: `${users[1]}@test.local`,
      household: { create: { name: "Casa B" } },
    },
    include: { household: true },
  });
  owner = first.household!.id;
  other = second.household!.id;
});
afterAll(async () => {
  if (photoId) await db.job.deleteMany({ where: { id: `background:${photoId}` } });
  await db.household.deleteMany({ where: { ownerId: { in: users } } });
  await db.user.deleteMany({ where: { id: { in: users } } });
  await db.requestLimit.deleteMany();
  await db.$disconnect();
});

describe("Personalização do modo Foto", () => {
  it("começa sem layout publicado e valida configuração sem HTML arbitrário", async () => {
    expect((await frameState(db, owner)).config).toEqual(defaultPhotoFrame);
    expect(
      photoFrameSchema.safeParse({
        ...defaultPhotoFrame,
        background: { ...defaultPhotoFrame.background, color: "url(https://externo)" },
      }).success,
    ).toBe(false);
  });
  it("salva rascunho e rejeita sobrescrita com revisão antiga", async () => {
    expect(
      await saveFrame(db, owner, users[0], { ...defaultPhotoFrame, caption: "Casa A" }, 0),
    ).toEqual({ draftRevision: 1 });
    await expect(saveFrame(db, owner, users[0], defaultPhotoFrame, 0)).rejects.toMatchObject({
      status: 409,
    });
    expect((await frameState(db, other)).draftRevision).toBe(0);
  });
  it("publica um snapshot imutável, sem permitir que novo rascunho altere o player", async () => {
    revision = (await publishFrame(db, owner, users[0], 1)).revision;
    await saveFrame(db, owner, users[0], { ...defaultPhotoFrame, caption: "Rascunho novo" }, 1);
    const published = await db.layoutVersion.findUniqueOrThrow({ where: { id: revision } });
    expect(photoFrameSchema.parse(published.config).caption).toBe("Casa A");
  });
  it("emite código temporário, de uso único, sem armazenar código ou token em texto", async () => {
    const pairing = await issuePairingCode(db, owner, users[0]);
    const result = await redeemPairingCode(db, pairing.code, "P7 Teste");
    token = result.token;
    deviceId = result.deviceId;
    expect((await db.device.findUniqueOrThrow({ where: { id: deviceId } })).tokenHash).not.toBe(
      token,
    );
    await expect(redeemPairingCode(db, pairing.code, "Duplicado")).rejects.toMatchObject({
      status: 400,
    });
    const credential = await authorizePlayer(db, `Bearer ${token}`);
    expect(credential.householdId).toBe(owner);
  });
  it("limita tentativas e rejeita códigos expirados", async () => {
    for (let i = 0; i < 10; i++) await limitPairing(db, "test-ip");
    await expect(limitPairing(db, "test-ip")).rejects.toMatchObject({ status: 429 });
    const code = await issuePairingCode(db, other, users[1]);
    await db.pairingCode.updateMany({
      where: { householdId: other },
      data: { expiresAt: new Date(0) },
    });
    await expect(redeemPairingCode(db, code.code, "Expirado")).rejects.toMatchObject({
      status: 400,
    });
  });
  it("serve apenas o snapshot publicado e valida heartbeat por conta", async () => {
    const device = await authorizePlayer(db, `Bearer ${token}`);
    const manifest = await playerManifest(db, device);
    expect(manifest?.layout.photoFrame?.caption).toBe("Casa A");
    expect(manifest?.media).toEqual([]);
    await acknowledgeFrame(db, device, revision);
    expect((await db.device.findUniqueOrThrow({ where: { id: deviceId } })).appliedRevision).toBe(
      revision,
    );
    await saveFrame(db, other, users[1], defaultPhotoFrame, 0);
    const foreign = await publishFrame(db, other, users[1], 1);
    await expect(acknowledgeFrame(db, device, foreign.revision)).rejects.toMatchObject({
      status: 400,
    });
  });
  it("otimiza uma foto, calcula hash e só permite publicar após processamento", async () => {
    const bytes = await sharp({
      create: { width: 2000, height: 1000, channels: 3, background: "#597564" },
    })
      .png()
      .toBuffer();
    const photo = await uploadBackground(db, owner, "foto.png", bytes);
    photoId = photo.id;
    const config = {
      ...defaultPhotoFrame,
      background: { ...defaultPhotoFrame.background, photoId },
    };
    await saveFrame(db, owner, users[0], config, 2);
    await expect(publishFrame(db, owner, users[0], 3)).rejects.toMatchObject({ status: 409 });
    await optimizeBackground(db, `background:${photoId}`);
    const processed = await db.media.findUniqueOrThrow({ where: { id: photoId } });
    expect(processed.width).toBe(1600);
    expect(processed.height).toBe(800);
    expect(processed.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect((await readBackground(photoId)).length).toBe(processed.bytes);
    await publishFrame(db, owner, users[0], 3);
    expect(
      (await playerManifest(db, await authorizePlayer(db, `Bearer ${token}`)))?.media[0].id,
    ).toBe(photoId);
    await expect(saveFrame(db, other, users[1], config, 1)).rejects.toMatchObject({ status: 400 });
  });
  it("revogação bloqueia imediatamente a credencial do dispositivo", async () => {
    await db.device.update({
      where: { id: deviceId },
      data: { revokedAt: new Date(), tokenHash: null },
    });
    await expect(authorizePlayer(db, `Bearer ${token}`)).rejects.toMatchObject({ status: 401 });
    await expect(authorizePlayer(db, "Bearer invalido")).rejects.toMatchObject({ status: 401 });
  });
});
