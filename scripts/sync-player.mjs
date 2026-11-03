import { mkdir, copyFile, cp } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
for (const directory of ["apps/web/public/player"]) {
  await mkdir(resolve(root, directory), { recursive: true });
  for (const name of ["index.html", "player.css", "player.js"]) {
    await copyFile(resolve(root, "packages/player/src", name), resolve(root, directory, name));
  }
}
const dashboardSource = resolve(root, "smartframe-player");
const dashboardTarget = resolve(root, "apps/web/public/player-dashboard");
await mkdir(dashboardTarget, { recursive: true });
for (const name of ["index.html", "css", "js", "assets"]) {
  await cp(resolve(dashboardSource, name), resolve(dashboardTarget, name), { recursive: true });
}
console.log(
  "Players web sincronizados. O Gradle usa a fonte existente para gerar os assets Android.",
);
