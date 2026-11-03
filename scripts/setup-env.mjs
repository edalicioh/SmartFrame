import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";

await mkdir(".data/media", { recursive: true });
try {
  await writeFile(
    ".env",
    [
      "DATABASE_URL=file:./.data/smartframe.db",
      `BETTER_AUTH_SECRET=${randomBytes(48).toString("base64url")}`,
      "BETTER_AUTH_URL=http://localhost:3000",
      "STORAGE_PATH=./.data/media",
      "SMARTFRAME_PORT=8080",
      "",
    ].join("\n"),
    { flag: "wx", mode: 0o600 },
  );
  console.log(".env criado com segredo aleatório. Nenhuma credencial padrão foi cadastrada.");
} catch (error) {
  if (error.code !== "EEXIST") throw error;
  console.log(".env já existe e foi preservado.");
}
