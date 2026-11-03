import "server-only";
import { getDatabase } from "@smartframe/database";
import { checkOnlinePlayer } from "./online-player-authorization";

export async function authorizeOnlinePlayer(request: Request) {
  await checkOnlinePlayer(
    getDatabase(),
    request.headers.get("authorization"),
    process.env.SMARTFRAME_ONLINE_HOUSEHOLD_ID,
  );
}
