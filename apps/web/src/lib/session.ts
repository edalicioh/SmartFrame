import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { panelAccess } from "./panel-access";

export async function requireAdministrator() {
  const context = await panelAccess(await headers());
  if (!context) redirect("/login");
  return { session: { user: context.user }, household: context.household };
}
