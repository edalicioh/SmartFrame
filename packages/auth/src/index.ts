import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import type { PrismaClient } from "@smartframe/database";
import { z } from "zod";
export {
  isAdminLoginDisabled,
  isLocalPanelRequest,
  localAdministrator,
  localPanelRedirect,
} from "./local-panel";

const configSchema = z.object({
  secret: z.string().min(32),
  baseURL: z.url().refine((value) => ["http:", "https:"].includes(new URL(value).protocol)),
});

export function createAuth(
  database: PrismaClient,
  configuration: { secret: string; baseURL: string },
) {
  const config = configSchema.parse(configuration);
  return betterAuth({
    appName: "SmartFrame",
    secret: config.secret,
    baseURL: config.baseURL,
    database: prismaAdapter(database, { provider: "sqlite", transaction: true }),
    trustedOrigins: [new URL(config.baseURL).origin],
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
    },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 60,
      customRules: { "/sign-in/email": { window: 60, max: 5 } },
    },
    advanced: {
      cookiePrefix: "smartframe",
      useSecureCookies: new URL(config.baseURL).protocol === "https:",
      // A biblioteca relaxa a checagem por padrão em NODE_ENV=test; testamos a política real.
      disableOriginCheck: false,
      disableCSRFCheck: false,
    },
  });
}

export async function getOwnedHousehold(database: PrismaClient, userId: string) {
  return database.household.findUnique({ where: { ownerId: userId } });
}
