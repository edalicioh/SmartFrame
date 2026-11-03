import { getDatabase } from "@smartframe/database";
import { acknowledgeFrame, authorizePlayer, playerManifest } from "@smartframe/frames";
import { frameResponse, privateHeaders } from "@/lib/frame-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return frameResponse(async () => {
    const db = getDatabase();
    const device = await authorizePlayer(db, request.headers.get("authorization"));
    await acknowledgeFrame(db, device, null);
    const manifest = await playerManifest(db, device);
    if (!manifest) return new Response(null, { status: 204, headers: privateHeaders });
    return Response.json(manifest, {
      headers: { ...privateHeaders, ETag: `"${manifest.revision}"` },
    });
  });
}
