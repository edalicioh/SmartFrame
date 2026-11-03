import type { PrismaClient } from "@smartframe/database";
import { authorizePlayer, FrameError } from "@smartframe/frames";

export async function checkOnlinePlayer(
  db: PrismaClient,
  authorization: string | null,
  household: string | undefined,
) {
  const device = await authorizePlayer(db, authorization);
  if (!household || device.householdId !== household)
    throw new FrameError(403, "Player online não autorizado.");
}
