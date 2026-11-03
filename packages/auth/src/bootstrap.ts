import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import type { PrismaClient } from "@smartframe/database";
import { z } from "zod";

const administratorSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.email().transform((value) => value.toLowerCase()),
  password: z.string().min(12).max(128),
});

export async function bootstrapAdministrator(
  database: PrismaClient,
  input: z.input<typeof administratorSchema>,
) {
  const data = administratorSchema.parse(input);
  if (await database.installation.findUnique({ where: { id: "initial-setup" } })) {
    throw new Error("A instalação já foi configurada. O administrador existente não foi alterado.");
  }
  const password = await hashPassword(data.password);
  return database.$transaction(async (tx) => {
    await tx.installation.create({ data: { id: "initial-setup" } });
    const id = randomUUID();
    const user = await tx.user.create({
      data: {
        id,
        name: data.name,
        email: data.email,
        accounts: {
          create: { id: randomUUID(), accountId: id, providerId: "credential", password },
        },
        household: { create: { name: "Minha casa" } },
      },
      include: { household: true },
    });
    await tx.auditLog.create({
      data: { householdId: user.household!.id, actorId: id, action: "installation.initialized" },
    });
    return { id: user.id, email: user.email };
  });
}
