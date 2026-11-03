import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "@smartframe/database";
import { createAuth, getOwnedHousehold } from "@smartframe/auth";
import { bootstrapAdministrator } from "@smartframe/auth/bootstrap";

const database = createDatabase(process.env.DATABASE_URL!);
const auth = createAuth(database, {
  baseURL: "http://localhost:3000",
  secret: "test-only-secret-with-at-least-32-characters-not-for-production",
});
const admin = {
  name: "Administrador Teste",
  email: "Admin@smartframe.test",
  password: "test-only-long-password-123!",
};

beforeAll(async () => {
  await bootstrapAdministrator(database, admin);
});
afterAll(async () => {
  await database.$disconnect();
});

function request(path: string, body: unknown, origin = "http://localhost:3000", cookie?: string) {
  return auth.handler(
    new Request(`http://localhost:3000/api/auth${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: origin,
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
}

describe("Configuração e autenticação", () => {
  it("cria o proprietário, sua conta e auditoria sem senha em texto", async () => {
    const user = await database.user.findUniqueOrThrow({
      where: { email: admin.email.toLowerCase() },
      include: { accounts: true, household: true },
    });
    expect(user.household?.name).toBe("Minha casa");
    expect(user.accounts[0].password).not.toBe(admin.password);
    expect(
      await database.auditLog.count({
        where: { actorId: user.id, action: "installation.initialized" },
      }),
    ).toBe(1);
  });
  it("não substitui o administrador se a configuração for executada novamente", async () => {
    await expect(
      bootstrapAdministrator(database, { ...admin, email: "outro@smartframe.test" }),
    ).rejects.toThrow("já foi configurada");
    expect(await database.user.count()).toBe(1);
  });
  it("exige senha forte no bootstrap e segredo adequado na autenticação", async () => {
    await expect(bootstrapAdministrator(database, { ...admin, password: "123" })).rejects.toThrow();
    expect(() =>
      createAuth(database, { baseURL: "http://localhost:3000", secret: "curto" }),
    ).toThrow();
  });
  it("não permite cadastro administrativo público", async () => {
    const response = await request("/sign-up/email", {
      name: "Invasor",
      email: "publico@smartframe.test",
      password: admin.password,
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await database.user.count()).toBe(1);
  });
  it("não autentica senha incorreta", async () => {
    const response = await request("/sign-in/email", {
      email: admin.email.toLowerCase(),
      password: "senha-incorreta",
    });
    expect(response.status).toBe(401);
  });
  it("bloqueia uma origem externa", async () => {
    const response = await request(
      "/sign-in/email",
      { email: admin.email.toLowerCase(), password: admin.password },
      "https://origem-nao-autorizada.test",
    );
    expect(response.status).toBe(403);
  });
  it("autentica, verifica sessão HttpOnly e revoga ao sair", async () => {
    const response = await request("/sign-in/email", {
      email: admin.email.toLowerCase(),
      password: admin.password,
    });
    expect(response.status).toBe(200);
    const cookies = response.headers.getSetCookie();
    expect(cookies.some((cookie) => cookie.toLowerCase().includes("httponly"))).toBe(true);
    const cookie = cookies.map((value) => value.split(";")[0]).join("; ");
    const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
    expect(session?.user.email).toBe(admin.email.toLowerCase());
    const signout = await request("/sign-out", {}, "http://localhost:3000", cookie);
    expect(signout.status).toBe(200);
    expect(await auth.api.getSession({ headers: new Headers({ cookie }) })).toBeNull();
  });
  it("não associa um usuário desconhecido à conta do proprietário", async () => {
    expect(await getOwnedHousehold(database, randomUUID())).toBeNull();
    const user = await database.user.findUniqueOrThrow({
      where: { email: admin.email.toLowerCase() },
    });
    expect((await getOwnedHousehold(database, user.id))?.ownerId).toBe(user.id);
  });
  it("limita tentativas repetidas de login", async () => {
    let response: Response | undefined;
    for (let attempt = 0; attempt < 6; attempt++) {
      response = await auth.handler(
        new Request("http://localhost:3000/api/auth/sign-in/email", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://localhost:3000",
            "X-Forwarded-For": "203.0.113.47",
          },
          body: JSON.stringify({ email: admin.email.toLowerCase(), password: "senha-incorreta" }),
        }),
      );
    }
    expect(response?.status).toBe(429);
  });
});
