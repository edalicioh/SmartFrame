import "server-only";
import type { PrismaClient } from "@smartframe/database";

/** Resolve the version pinned to a device without trusting an ID from the request. */
export async function activeOnlineVersion(
  db: PrismaClient,
  device: {
    id: string;
    householdId: string;
    activePanelId: string | null;
    activePanelVersionId: string | null;
  },
) {
  if (device.activePanelId) {
    return db.layoutVersion.findFirst({
      where: {
        id: device.activePanelVersionId ?? "",
        layoutId: device.activePanelId,
        layout: { householdId: device.householdId },
      },
    });
  }
  // Older installations had one online layout per device. Preserve this fallback,
  // but never use a legacy layout belonging to a different household.
  const layout = await db.layout.findFirst({
    where: { key: `online:${device.id}`, householdId: device.householdId },
    include: { publishedVersion: true },
  });
  const version = layout?.publishedVersion;
  return version?.layoutId === layout?.id ? version : null;
}
