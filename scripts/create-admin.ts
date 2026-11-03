import { createInterface } from "node:readline/promises";
import { getDatabase } from "@smartframe/database";
import { bootstrapAdministrator } from "@smartframe/auth/bootstrap";

const readline = createInterface({ input: process.stdin, output: process.stdout });
const database = getDatabase();
try {
  const name = process.env.SMARTFRAME_ADMIN_NAME ?? (await readline.question("Nome: "));
  const email = process.env.SMARTFRAME_ADMIN_EMAIL ?? (await readline.question("E-mail: "));
  if (!process.env.SMARTFRAME_ADMIN_PASSWORD) {
    throw new Error(
      "Informe SMARTFRAME_ADMIN_PASSWORD no ambiente (12–128 caracteres). A senha não será solicitada com eco no terminal.",
    );
  }
  const user = await bootstrapAdministrator(database, {
    name,
    email,
    password: process.env.SMARTFRAME_ADMIN_PASSWORD,
  });
  console.log(`Administrador criado: ${user.email}. O cadastro público permanece desabilitado.`);
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Não foi possível configurar o administrador.",
  );
  process.exitCode = 1;
} finally {
  readline.close();
  await database.$disconnect();
}
