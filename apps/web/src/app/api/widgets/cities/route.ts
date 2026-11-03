import { z } from "zod";
import { searchCities } from "@smartframe/widgets";
import { FrameError } from "@smartframe/frames";
import { administrator, frameResponse, privateHeaders } from "@/lib/frame-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return frameResponse(async () => {
    await administrator(request);
    const query = z
      .string()
      .trim()
      .min(3)
      .max(80)
      .parse(new URL(request.url).searchParams.get("q"));
    try {
      return Response.json({ cities: await searchCities(query) }, { headers: privateHeaders });
    } catch {
      throw new FrameError(
        503,
        "Busca de cidades indisponível. Tente novamente em alguns instantes.",
      );
    }
  });
}
