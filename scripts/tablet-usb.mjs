import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";

const run = promisify(execFile);
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

export function hasForward(output, port) {
  return output.split(/\r?\n/).some((line) => {
    const fields = line.trim().split(/\s+/);
    return fields[1] === `tcp:${port}` && fields[2] === `tcp:${port}`;
  });
}

export function connectionOptions(args) {
  const { values } = parseArgs({
    args,
    options: { serial: { type: "string" }, port: { type: "string", default: "3000" } },
  });
  if (!values.serial || !/^[A-Za-z0-9._:-]{1,128}$/.test(values.serial))
    throw new Error("Informe o tablet: npm run tablet:usb -- --serial SERIAL");
  if (!/^\d+$/.test(values.port) || Number(values.port) < 1 || Number(values.port) > 65535)
    throw new Error("A porta deve ser um inteiro entre 1 e 65535.");
  return { serial: values.serial, port: Number(values.port) };
}

async function main() {
  const { serial, port } = connectionOptions(process.argv.slice(2));
  const localAdb = resolve(
    root,
    ".data/android-toolchain/sdk/platform-tools",
    process.platform === "win32" ? "adb.exe" : "adb",
  );
  const adb = process.env.ADB_PATH || (existsSync(localAdb) ? localAdb : "adb");
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  let status = "";
  const report = (message) => {
    if (status !== message) {
      console.log(message);
      status = message;
    }
  };
  const command = (args) =>
    run(adb, ["-s", serial, ...args], {
      timeout: 5000,
      maxBuffer: 64 * 1024,
      windowsHide: true,
      signal: controller.signal,
    });
  console.log(
    `Monitor USB do tablet ${serial}; porta ${port}. Não altera o pareamento nem abre o servidor na rede.`,
  );
  try {
    while (!controller.signal.aborted) {
      try {
        const state = await command(["get-state"]);
        if (state.stdout.trim() !== "device") throw new Error("Tablet indisponível");
        const forwards = await command(["reverse", "--list"]);
        if (!hasForward(forwards.stdout, port)) {
          await command(["reverse", `tcp:${port}`, `tcp:${port}`]);
          const check = await command(["reverse", "--list"]);
          if (!hasForward(check.stdout, port)) throw new Error("Encaminhamento indisponível");
          // Do not steal focus, restart apps, or change other devices / forwards.
          status = "";
        }
        report(`Conexão USB pronta: localhost:${port} no tablet → computador.`);
      } catch {
        if (!controller.signal.aborted)
          report(
            "Aguardando o tablet responder ao USB; mantenha o cabo conectado e a depuração autorizada.",
          );
      }
      try {
        await delay(10000, undefined, { signal: controller.signal });
      } catch {
        break;
      }
    }
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
