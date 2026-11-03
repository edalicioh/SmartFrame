import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { defineConfig } from "vitest/config";

process.env.DATABASE_URL = `file:${resolve(".data", `test-${randomUUID()}.db`)}`;
process.env.STORAGE_PATH = resolve(".data", `test-media-${randomUUID()}`);

export default defineConfig({
  resolve: { alias: { "@": resolve("apps/web/src") } },
  test: {
    include: ["tests/**/*.test.ts"],
    globalSetup: ["./tests/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 15000,
    hookTimeout: 30000,
    env: { DATABASE_URL: process.env.DATABASE_URL, STORAGE_PATH: process.env.STORAGE_PATH },
  },
});
