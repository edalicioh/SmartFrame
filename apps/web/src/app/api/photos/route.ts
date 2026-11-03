import { getDatabase } from "@smartframe/database";
import { FrameError, uploadBackground } from "@smartframe/frames";
import { administrator, frameResponse, limitedBody, privateHeaders } from "@/lib/frame-api";

export const runtime = "nodejs";
export async function POST(request: Request) {
  return frameResponse(async () => {
    const owner = await administrator(request, true);
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.startsWith("multipart/form-data;"))
      throw new FrameError(400, "Envie uma foto usando o formulário.");
    const bytes = await limitedBody(request, 13 * 1024 ** 2);
    let form: FormData;
    try {
      form = await new Response(bytes, { headers: { "Content-Type": contentType } }).formData();
    } catch {
      throw new FrameError(400, "Formulário inválido.");
    }
    const file = form.get("photo");
    if (!(file instanceof File) || !["image/jpeg", "image/png", "image/webp"].includes(file.type))
      throw new FrameError(400, "Escolha uma foto JPEG, PNG ou WebP.");
    return Response.json(
      await uploadBackground(
        getDatabase(),
        owner.householdId,
        file.name,
        Buffer.from(await file.arrayBuffer()),
      ),
      { status: 202, headers: privateHeaders },
    );
  });
}
