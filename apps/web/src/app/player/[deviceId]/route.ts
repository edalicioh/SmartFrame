import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { FrameError } from "@smartframe/frames";
import { frameResponse } from "@/lib/frame-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ deviceId: string }> }) {
  return frameResponse(async () => {
    const { deviceId } = await context.params;
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(deviceId))
      throw new FrameError(404, "Player não encontrado.");
    // The launcher runs at the repository root; npm's web workspace runs at apps/web.
    // Both paths are fixed server paths, never derived from the requested device ID.
    let html: string;
    try {
      html = await readFile(resolve(process.cwd(), "smartframe-player", "index.html"), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      html = await readFile(resolve(process.cwd(), "../../smartframe-player/index.html"), "utf8");
    }
    return new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Security-Policy":
          "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "SAMEORIGIN",
      },
    });
  });
}
