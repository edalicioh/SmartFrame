import { z } from "zod";
import { getDatabase } from "@smartframe/database";
import {
  createControlDeckBinding,
  deleteControlDeckBinding,
  listControlDeckBindings,
  updateControlDeckBinding,
} from "@smartframe/frames";
import { administrator, frameResponse, jsonBody, privateHeaders } from "@/lib/frame-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bindingIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);

export async function GET(request: Request) {
  return frameResponse(async () => {
    const owner = await administrator(request);
    const bindings = await listControlDeckBindings(getDatabase(), owner.householdId);
    return Response.json({ bindings }, { headers: privateHeaders });
  });
}

export async function POST(request: Request) {
  return frameResponse(async () => {
    const owner = await administrator(request, true);
    const body = await jsonBody(request);
    const binding = await createControlDeckBinding(
      getDatabase(),
      owner.householdId,
      owner.actorId,
      body,
    );
    return Response.json({ binding }, { status: 201, headers: privateHeaders });
  });
}

export async function PUT(request: Request) {
  return frameResponse(async () => {
    const owner = await administrator(request, true);
    const body = await jsonBody(request);
    const binding = await updateControlDeckBinding(
      getDatabase(),
      owner.householdId,
      owner.actorId,
      body,
    );
    return Response.json({ binding }, { headers: privateHeaders });
  });
}

export async function DELETE(request: Request) {
  return frameResponse(async () => {
    const owner = await administrator(request, true);
    const queryId = new URL(request.url).searchParams.get("id");
    const id =
      queryId !== null
        ? bindingIdSchema.parse(queryId)
        : z.object({ id: bindingIdSchema }).strict().parse(await jsonBody(request)).id;
    await deleteControlDeckBinding(getDatabase(), owner.householdId, owner.actorId, id);
    return Response.json({ ok: true }, { headers: privateHeaders });
  });
}
