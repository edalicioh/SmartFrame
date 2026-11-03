import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { panelAccess } from "./panel-access";
import { isAdminLoginDisabled, localPanelRedirect } from "@smartframe/auth";

export async function requireAdministrator(pathname: "/" | "/layouts" = "/") {
  const requestHeaders = await headers();
  if (isAdminLoginDisabled()) {
    const target = localPanelRedirect(requestHeaders, process.env.BETTER_AUTH_URL ?? "", pathname);
    if (target) redirect(target);
  }
  const context = await panelAccess(requestHeaders);
  if (!context) redirect("/login");
  return { session: { user: context.user }, household: context.household };
}
