import { afterAll, describe, expect, it } from "vitest";
import { createDatabase } from "@smartframe/database";

const database = createDatabase(process.env.DATABASE_URL!);
afterAll(async () => {
  await database.$disconnect();
});

describe("SQLite", () => {
  it("usa WAL e impõe integridade referencial na conexão Prisma", async () => {
    const mode = await database.$queryRawUnsafe<{ journal_mode: string }[]>("PRAGMA journal_mode");
    const constraints =
      await database.$queryRawUnsafe<{ foreign_keys: bigint }[]>("PRAGMA foreign_keys");
    expect(mode[0].journal_mode).toBe("wal");
    expect(Number(constraints[0].foreign_keys)).toBe(1);
  });
  it("não aceita referências a proprietários inexistentes", async () => {
    await expect(
      database.household.create({ data: { name: "Sem proprietário", ownerId: "nao-existe" } }),
    ).rejects.toThrow();
  });
  it("não aceita URLs de banco remoto ou parâmetros de arquivo", () => {
    expect(() => createDatabase("https://banco.test")).toThrow("arquivo SQLite local");
    expect(() => createDatabase("file:arquivo.db?mode=memory")).toThrow("sem parâmetros");
  });
});
