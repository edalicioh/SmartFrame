import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  { settings: { next: { rootDir: "apps/web/" } } },
  globalIgnores([
    "**/.next/**",
    "**/node_modules/**",
    "packages/database/generated/**",
    "apps/web/next-env.d.ts",
    "apps/android/**/build/**",
    "apps/android/.gradle/**",
    "apps/android/.kotlin/**",
    "apps/android/app/src/main/assets/player/**",
    "apps/web/public/player/**",
    "apps/web/public/player-dashboard/**",
    ".data/**",
  ]),
]);
