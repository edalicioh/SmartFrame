import { getAuth } from "@/lib/auth";
import { isAdminLoginDisabled } from "@smartframe/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (isAdminLoginDisabled())
    return Response.json(
      { error: "Login administrativo desativado." },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  return getAuth().handler(request);
}
export async function POST(request: Request) {
  if (isAdminLoginDisabled())
    return Response.json(
      { error: "Login administrativo desativado." },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  return getAuth().handler(request);
}
