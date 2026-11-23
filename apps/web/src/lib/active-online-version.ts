import "server-only";
import type { PrismaClient } from "@smartframe/database";

type DeviceRow = NonNullable<Awaited<ReturnType<PrismaClient["device"]["findFirst"]>>>;
type LayoutVersionRow = NonNullable<
  Awaited<ReturnType<PrismaClient["layoutVersion"]["findFirst"]>>
>;

type DeviceSelection = {
  id: string;
  householdId: string;
  activePanelId: string | null;
  activePanelVersionId: string | null;
};

type ActiveVersionDb = Pick<PrismaClient, "layout" | "layoutVersion"> &
  Partial<Pick<PrismaClient, "device" | "$transaction">>;

async function resolveWithOptionalDevice<T extends DeviceSelection>(
  db: PrismaClient,
  device: T,
  consistentRead: boolean,
): Promise<{ device: T; version: LayoutVersionRow | null } | null> {
  const resolve = async (
    tx: ActiveVersionDb,
    reReadDevice: boolean,
  ): Promise<{ device: T; version: LayoutVersionRow | null } | null> => {
    let resolvedDevice: T = device;
    if (reReadDevice && tx.device) {
      const freshDevice = await tx.device.findFirst({
        where: { id: device.id, householdId: device.householdId, revokedAt: null },
      });
      if (!freshDevice) return null;
      resolvedDevice = freshDevice as unknown as T;
    }

    if (resolvedDevice.activePanelId) {
      const version = await tx.layoutVersion.findFirst({
        where: {
          id: resolvedDevice.activePanelVersionId ?? "",
          layoutId: resolvedDevice.activePanelId,
          layout: { householdId: resolvedDevice.householdId },
        },
      });
      return { device: resolvedDevice, version };
    }
    // Older installations had one online layout per device. Preserve this fallback,
    // but never use a legacy layout belonging to a different household.
    const layout = await tx.layout.findFirst({
      where: { key: `online:${resolvedDevice.id}`, householdId: resolvedDevice.householdId },
      include: { publishedVersion: true },
    });
    const candidate = layout?.publishedVersion ?? null;
    const version = candidate?.layoutId === layout?.id ? candidate : null;
    return { device: resolvedDevice, version };
  };

  const client = db as ActiveVersionDb;
  if (consistentRead && typeof client.$transaction === "function") {
    return client.$transaction((tx) => resolve(tx, true));
  }
  return resolve(client, false);
}

/**
 * Resolve the active device snapshot and published version inside the same
 * consistent read so response fields like page directives stay aligned with
 * the selected version.
 */
export async function activeOnlineVersionWithDevice<T extends DeviceRow>(
  db: PrismaClient,
  device: T,
): Promise<{ device: T; version: LayoutVersionRow } | null> {
  const resolved = await resolveWithOptionalDevice(db, device, true);
  if (!resolved?.version) return null;
  return { device: resolved.device, version: resolved.version };
}

/** Resolve the version pinned to a device without trusting an ID from the request. */
export async function activeOnlineVersion(
  db: PrismaClient,
  device: DeviceSelection,
  options: { consistentRead?: boolean } = {},
): Promise<LayoutVersionRow | null> {
  const { consistentRead = true } = options;
  const resolved = await resolveWithOptionalDevice(db, device, consistentRead);
  return resolved?.version ?? null;
}
