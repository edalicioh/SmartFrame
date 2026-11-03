import { frameResponse, privateHeaders } from "@/lib/frame-api";
import { authorizeOnlinePlayer } from "@/lib/online-player-access";
import { onlineConfig, onlinePaths } from "@/lib/online-player";
import { getDatabase } from "@smartframe/database";
import { FrameError } from "@smartframe/frames";
import { onlineWidgetData } from "@smartframe/widgets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return frameResponse(async () => {
    await authorizeOnlinePlayer(request);
    const paths = onlinePaths();
    const config = await onlineConfig(paths.config, paths.photos);
    const widgetData = await onlineWidgetData(getDatabase(), config.widgets);
    const result = { ...config, widgetData };
    if (Buffer.byteLength(JSON.stringify(result), "utf8") > 1024 * 1024)
      throw new FrameError(413, "Configuração e widgets excedem o limite de 1 MiB.");
    return Response.json(result, { headers: privateHeaders });
  });
}
