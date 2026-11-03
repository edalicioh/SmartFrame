import { execFileSync } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

export default async function setup() {
  await mkdir(".data", { recursive: true });
  execFileSync(
    process.execPath,
    [resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"],
    {
      env: process.env,
      stdio: "pipe",
    },
  );
  const filename = process.env.DATABASE_URL!.slice(5);
  return async () => {
    for (const suffix of ["", "-wal", "-shm"]) await rm(`${filename}${suffix}`, { force: true });
    await rm(process.env.STORAGE_PATH!, { recursive: true, force: true });
  };
}
