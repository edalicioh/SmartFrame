import { createLinuxDriver } from "./drivers/linux";
import { createUnsupportedDriver } from "./drivers/unsupported";
import { createWindowsDriver } from "./drivers/windows";
import { createControlDeckAgentServer } from "./server";
import { loadShortcutsFromFile } from "./shortcuts";

const port = Number(process.env.SMARTFRAME_CONTROL_DECK_PORT ?? "3789");
const token = process.env.SMARTFRAME_CONTROL_DECK_TOKEN?.trim() ?? "";
const shortcutsFile = process.env.SMARTFRAME_CONTROL_DECK_SHORTCUTS_FILE;
const host = process.env.SMARTFRAME_CONTROL_DECK_HOST?.trim() || "127.0.0.1";

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error("Control Deck Agent: porta inválida.");
  process.exit(1);
}

if (token.length < 32 || /\s/.test(token)) {
  console.error(
    "Control Deck Agent: defina SMARTFRAME_CONTROL_DECK_TOKEN com pelo menos 32 caracteres sem espaços.",
  );
  process.exit(1);
}

const driver =
  process.platform === "win32"
    ? createWindowsDriver()
    : process.platform === "linux"
      ? createLinuxDriver()
      : createUnsupportedDriver();

const shortcuts = await loadShortcutsFromFile(shortcutsFile);
const agent = createControlDeckAgentServer({
  host,
  port,
  token,
  driver,
  shortcuts,
});

const bound = await agent.listen();
console.log(
  `SmartFrame Control Deck Agent ativo em http://${bound.host}:${bound.port} (${driver.platform}).`,
);

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  await agent.close();
  process.exit(0);
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
