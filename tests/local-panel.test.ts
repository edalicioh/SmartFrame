import { afterEach, describe, expect, it, vi } from "vitest";
import { isAdminLoginDisabled, isLocalPanelRequest, localAdministrator } from "@smartframe/auth";
import type { PrismaClient } from "@smartframe/database";

afterEach(() => vi.unstubAllEnvs());
describe("Painel local sem login", () => {
  it("exige opção explícita para desativar o login", () => {
    vi.stubEnv("SMARTFRAME_ADMIN_LOGIN", "required");
    expect(isAdminLoginDisabled()).toBe(false);
    vi.stubEnv("SMARTFRAME_ADMIN_LOGIN", "qualquer");
    expect(isAdminLoginDisabled()).toBe(false);
    vi.stubEnv("SMARTFRAME_ADMIN_LOGIN", "disabled");
    expect(isAdminLoginDisabled()).toBe(true);
  });
  it("aceita apenas origem local, Host correto e acesso não cross-site", () => {
    expect(
      isLocalPanelRequest(new Headers({ host: "localhost:8080" }), "http://localhost:8080"),
    ).toBe(true);
    expect(isLocalPanelRequest(new Headers({ host: "evil.test" }), "http://localhost:8080")).toBe(
      false,
    );
    expect(
      isLocalPanelRequest(new Headers({ host: "meu-servidor.test" }), "https://meu-servidor.test"),
    ).toBe(false);
    expect(
      isLocalPanelRequest(
        new Headers({ host: "localhost:8080", "sec-fetch-site": "cross-site" }),
        "http://localhost:8080",
      ),
    ).toBe(false);
  });
  it("usa o perfil existente sem criar ou alterar usuários", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: "casa",
        name: "Minha casa",
        owner: { id: "dono", name: "Nome existente", email: "dono@test.local" },
      },
    ]);
    const db = { household: { findMany } } as unknown as PrismaClient;
    expect(await localAdministrator(db, " DONO@test.local ")).toMatchObject({
      user: { id: "dono" },
      household: { id: "casa" },
    });
    expect(findMany.mock.calls[0][0].where).toEqual({ owner: { email: "dono@test.local" } });
  });
  it("não escolhe uma conta arbitrária quando há zero ou vários proprietários", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const db = { household: { findMany } } as unknown as PrismaClient;
    await expect(localAdministrator(db)).rejects.toThrow("Nenhum perfil");
    findMany.mockResolvedValue([{}, {}]);
    await expect(localAdministrator(db)).rejects.toThrow("SMARTFRAME_ADMIN_EMAIL");
  });
});
