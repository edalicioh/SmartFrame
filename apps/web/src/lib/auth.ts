import "server-only";
import { createAuth } from "@smartframe/auth";
import { getDatabase } from "@smartframe/database";

let instance: ReturnType<typeof createAuth> | undefined;

export function getAuth() {
  if (!process.env.BETTER_AUTH_SECRET || !process.env.BETTER_AUTH_URL) {
    throw new Error(
      "Configure BETTER_AUTH_SECRET e BETTER_AUTH_URL no .env antes de iniciar o servidor.",
    );
  }
  instance ??= createAuth(getDatabase(), {
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.BETTER_AUTH_URL,
  });
  return instance;
}
