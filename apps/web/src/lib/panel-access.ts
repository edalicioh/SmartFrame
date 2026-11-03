import "server-only";
import {
  getOwnedHousehold,
  isAdminLoginDisabled,
  isLocalPanelRequest,
  localAdministrator,
} from "@smartframe/auth";
import { getDatabase } from "@smartframe/database";
import { FrameError } from "@smartframe/frames";
import { getAuth } from "./auth";

export async function panelAccess(headers: Headers | Pick<Headers, "get">) {
  const database = getDatabase();
  if (isAdminLoginDisabled()) {
    if (!isLocalPanelRequest(headers, process.env.BETTER_AUTH_URL ?? "")) {
      throw new FrameError(
        403,
        "O painel sem login só pode ser acessado pelo endereço local configurado.",
      );
    }
    return localAdministrator(database, process.env.SMARTFRAME_ADMIN_EMAIL);
  }
  const session = await getAuth().api.getSession({ headers: headers as Headers });
  if (!session) return null;
  const household = await getOwnedHousehold(database, session.user.id);
  if (!household) throw new FrameError(403, "Conta não autorizada.");
  return { user: session.user, household };
}
