import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import Database from "better-sqlite3";
import { PrismaClient } from "../generated/client";

export { PrismaClient } from "../generated/client";

export function createDatabase(url: string) {
  if (!url.startsWith("file:") || url.includes("?")) {
    throw new Error("DATABASE_URL deve apontar para um arquivo SQLite local, sem parâmetros.");
  }
  const filename = resolve(url.slice(5));
  mkdirSync(dirname(filename), { recursive: true });
  const sqlite = new Database(filename);
  try {
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("busy_timeout = 5000");
    sqlite.pragma("foreign_keys = ON");
  } finally {
    sqlite.close();
  }
  return new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url: `file:${filename}`, timeout: 5000 }),
  });
}

const globalDatabase = globalThis as unknown as { smartframeDatabase?: PrismaClient };

export function getDatabase() {
  globalDatabase.smartframeDatabase ??= createDatabase(
    process.env.DATABASE_URL ?? "file:./.data/smartframe.db",
  );
  return globalDatabase.smartframeDatabase;
}
