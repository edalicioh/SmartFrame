import { setTimeout } from "node:timers/promises";
import { getDatabase } from "@smartframe/database";
import { runOneJob, scheduleMaintenance, scheduleWidgetRefresh } from "@smartframe/jobs";

const database = getDatabase();
const abort = new AbortController();
process.once("SIGINT", () => abort.abort());
process.once("SIGTERM", () => abort.abort());

console.log("SmartFrame worker iniciado. Handlers: manutenção, fotos, clima e cotações.");
try {
  while (!abort.signal.aborted) {
    try {
      await scheduleMaintenance(database);
      await scheduleWidgetRefresh(database);
      const processed = await runOneJob(database);
      if (processed) continue;
    } catch {
      console.error("Worker: banco indisponível. Nova tentativa em 5 segundos.");
    }
    try {
      await setTimeout(5000, undefined, { signal: abort.signal });
    } catch (error) {
      if (!abort.signal.aborted) throw error;
    }
  }
} finally {
  await database.$disconnect();
  console.log("SmartFrame worker encerrado.");
}
