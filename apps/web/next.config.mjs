import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
config({ path: resolve(root, ".env"), quiet: true });
// Prisma CLI e Next devem apontar para o mesmo arquivo, mesmo com cwd diferente.
const databaseUrl = process.env.DATABASE_URL ?? "file:./.data/smartframe.db";
if (databaseUrl.startsWith("file:"))
  process.env.DATABASE_URL = `file:${resolve(root, databaseUrl.slice(5))}`;
process.env.STORAGE_PATH = resolve(root, process.env.STORAGE_PATH ?? ".data/media");
process.env.SMARTFRAME_ONLINE_CONFIG = resolve(
  root,
  process.env.SMARTFRAME_ONLINE_CONFIG ?? ".data/player-online/config.json",
);
process.env.SMARTFRAME_ONLINE_PHOTOS = resolve(
  root,
  process.env.SMARTFRAME_ONLINE_PHOTOS ?? ".data/player-online/photos",
);

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    "@smartframe/widgets",
    "@smartframe/auth",
    "@smartframe/contracts",
    "@smartframe/database",
    "@smartframe/frames",
  ],
  serverExternalPackages: ["better-sqlite3", "@prisma/adapter-better-sqlite3"],
  poweredByHeader: false,
  turbopack: { root },
  async redirects() {
    return [
      {
        source: "/player-dashboard",
        destination: "/player-dashboard/index.html",
        permanent: false,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
      { source: "/player/:path*", headers: [{ key: "X-Frame-Options", value: "SAMEORIGIN" }] },
      {
        source: "/player-dashboard/:path*",
        headers: [{ key: "X-Frame-Options", value: "SAMEORIGIN" }],
      },
    ];
  },
};

export default nextConfig;
