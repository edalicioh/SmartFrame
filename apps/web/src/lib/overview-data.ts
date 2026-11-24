import "server-only";
import type { PrismaClient } from "@smartframe/database";
import {
  deriveOverviewGuidance,
  mapOverviewDeviceCard,
  mapOverviewPanelCard,
  OVERVIEW_DEVICES_LIMIT,
  OVERVIEW_PANELS_LIMIT,
  OVERVIEW_PHOTOS_LIMIT,
  type OverviewDeviceCard,
  type OverviewGuidance,
  type OverviewPanelCard,
} from "./online-editor/overview";
import {
  deriveDeviceActiveStatus,
  type DeviceSummary,
  type PanelSummary,
} from "./online-editor/publication";

export type OverviewPhotoItem = {
  id: string;
  filename: string;
  status: string;
};

export type OverviewData = {
  totals: {
    devices: number;
    panels: number;
    photos: number;
    readyPhotos: number;
    pendingPhotos: number;
    failedPhotos: number;
    confirmedDevices: number;
    devicesWithoutPanel: number;
    devicesPendingConfirmation: number;
  };
  devices: OverviewDeviceCard[];
  panels: OverviewPanelCard[];
  recentPhotos: OverviewPhotoItem[];
  guidance: OverviewGuidance;
};

type OverviewDb = Pick<
  PrismaClient,
  "media" | "device" | "layout" | "layoutVersion" | "devicePanelAccess"
> &
  Partial<Pick<PrismaClient, "$transaction">>;

const SQLITE_IN_CHUNK_SIZE = 250;

async function queryInChunks<T, R>(
  items: readonly T[],
  loader: (chunk: T[]) => Promise<R[]>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results: R[] = [];
  for (let offset = 0; offset < items.length; offset += SQLITE_IN_CHUNK_SIZE) {
    const rows = await loader(items.slice(offset, offset + SQLITE_IN_CHUNK_SIZE));
    results.push(...rows);
  }
  return results;
}

export const eligiblePanelWhere = (householdId: string) => ({
  householdId,
  OR: [{ key: { startsWith: "panel:" } }, { key: { startsWith: "online:" } }],
});

async function queryOverviewSnapshot(
  tx: Pick<PrismaClient, "media" | "device" | "layout" | "layoutVersion" | "devicePanelAccess">,
  householdId: string,
): Promise<OverviewData> {
  const [
    totalPhotos,
    readyPhotos,
    pendingPhotos,
    failedPhotos,
    recentPhotos,
    allHouseholdDevices,
    totalPanels,
    panelRows,
  ] = await Promise.all([
    tx.media.count({ where: { householdId } }),
    tx.media.count({ where: { householdId, status: "ready" } }),
    tx.media.count({ where: { householdId, status: { in: ["pending", "processing"] } } }),
    tx.media.count({ where: { householdId, status: { in: ["error", "failed"] } } }),
    tx.media.findMany({
      where: { householdId },
      select: { id: true, filename: true, status: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: OVERVIEW_PHOTOS_LIMIT,
    }),
    tx.device.findMany({
      where: { householdId, revokedAt: null },
      select: {
        id: true,
        name: true,
        timezone: true,
        lastSeenAt: true,
        appliedRevision: true,
        activePanelId: true,
        activePanelVersionId: true,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    }),
    tx.layout.count({ where: eligiblePanelWhere(householdId) }),
    tx.layout.findMany({
      where: eligiblePanelWhere(householdId),
      select: {
        id: true,
        name: true,
        key: true,
        draftRevision: true,
        publishedVersionId: true,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: OVERVIEW_PANELS_LIMIT,
    }),
  ]);

  const totalDevices = allHouseholdDevices.length;
  const deviceRows = allHouseholdDevices.slice(0, OVERVIEW_DEVICES_LIMIT);

  // Collect all candidate active panel IDs, version IDs, and legacy online:<deviceId> keys
  // inside the same consistent transaction snapshot, strictly scoped by householdId.
  const candidatePanelIds = [
    ...new Set(
      allHouseholdDevices
        .map((device) => device.activePanelId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const candidateVersionIds = [
    ...new Set(
      allHouseholdDevices
        .map((device) => device.activePanelVersionId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const devicesWithoutActivePanel = allHouseholdDevices.filter((device) => !device.activePanelId);
  const legacyCandidatePanels = panelRows.filter(
    (panel) => panel.key?.startsWith("online:") && Boolean(panel.publishedVersionId),
  );
  const legacyCandidateKeys = [
    ...new Set([
      ...devicesWithoutActivePanel.map((device) => `online:${device.id}`),
      ...legacyCandidatePanels.map((panel) => panel.key!),
    ]),
  ];

  const [relatedPanels, relatedVersions, legacyLayouts] = await Promise.all([
    queryInChunks(candidatePanelIds, (ids) =>
      tx.layout.findMany({
        where: {
          ...eligiblePanelWhere(householdId),
          id: { in: ids },
        },
        select: { id: true, name: true, key: true },
      }),
    ),
    candidatePanelIds.length > 0
      ? queryInChunks(candidateVersionIds, (ids) =>
          tx.layoutVersion.findMany({
            where: {
              id: { in: ids },
              layout: eligiblePanelWhere(householdId),
            },
            select: { id: true, layoutId: true },
          }),
        )
      : Promise.resolve([]),
    queryInChunks(legacyCandidateKeys, (keys) =>
      tx.layout.findMany({
        where: {
          householdId,
          key: { in: keys },
          publishedVersionId: { not: null },
        },
        select: { id: true, name: true, key: true, publishedVersionId: true },
      }),
    ),
  ]);

  const displayedPanelIds = panelRows.map((panel) => panel.id);
  const legacyLayoutIds = legacyLayouts.map((layout) => layout.id);
  const validationLayoutIdSet = new Set([...displayedPanelIds, ...legacyLayoutIds]);
  const panelPublishedVersionIds = panelRows
    .map((panel) => panel.publishedVersionId)
    .filter((id): id is string => Boolean(id));
  const legacyVersionIds = legacyLayouts
    .map((layout) => layout.publishedVersionId)
    .filter((id): id is string => Boolean(id));
  const validationVersionIds = [...new Set([...panelPublishedVersionIds, ...legacyVersionIds])];

  const [rawValidPublishedVersions, panelExistingVersions, panelAccessRows] = await Promise.all([
    validationLayoutIdSet.size > 0
      ? queryInChunks(validationVersionIds, (ids) =>
          tx.layoutVersion.findMany({
            where: {
              id: { in: ids },
              layout: eligiblePanelWhere(householdId),
            },
            select: { id: true, layoutId: true },
          }),
        )
      : Promise.resolve([]),
    displayedPanelIds.length > 0
      ? tx.layoutVersion.findMany({
          where: {
            layoutId: { in: displayedPanelIds },
            layout: eligiblePanelWhere(householdId),
          },
          select: { layoutId: true },
          distinct: ["layoutId"],
        })
      : Promise.resolve([]),
    displayedPanelIds.length > 0
      ? tx.devicePanelAccess.findMany({
          where: {
            panelId: { in: displayedPanelIds },
            device: { householdId, revokedAt: null },
            version: {
              layoutId: { in: displayedPanelIds },
              layout: eligiblePanelWhere(householdId),
            },
          },
          select: {
            deviceId: true,
            panelId: true,
            version: { select: { layoutId: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  const validPublishedVersions = rawValidPublishedVersions.filter((version) =>
    validationLayoutIdSet.has(version.layoutId),
  );
  const panelIdsWithAnyVersion = new Set(panelExistingVersions.map((row) => row.layoutId));
  const availableDeviceIdsByPanelId = new Map<string, Set<string>>();
  for (const access of panelAccessRows) {
    if (access.version.layoutId !== access.panelId) continue;
    const set = availableDeviceIdsByPanelId.get(access.panelId) ?? new Set<string>();
    set.add(access.deviceId);
    availableDeviceIdsByPanelId.set(access.panelId, set);
  }

  const validPanelById = new Map(relatedPanels.map((panel) => [panel.id, panel]));
  const validVersionLayoutById = new Map(
    relatedVersions.map((version) => [version.id, version.layoutId]),
  );
  const validPublishedVersionLayoutById = new Map(
    validPublishedVersions.map((version) => [version.id, version.layoutId]),
  );

  const legacyByDeviceId = new Map<
    string,
    { id: string; name: string; publishedVersionId: string }
  >();
  for (const layout of legacyLayouts) {
    if (
      layout.key?.startsWith("online:") &&
      layout.publishedVersionId &&
      validPublishedVersionLayoutById.get(layout.publishedVersionId) === layout.id
    ) {
      legacyByDeviceId.set(layout.key.slice("online:".length), {
        id: layout.id,
        name: layout.name,
        publishedVersionId: layout.publishedVersionId,
      });
    }
  }

  const allPanelMap = new Map<string, PanelSummary>();
  for (const panel of panelRows) {
    allPanelMap.set(panel.id, { id: panel.id, name: panel.name });
  }
  for (const panel of relatedPanels) {
    if (!allPanelMap.has(panel.id)) {
      allPanelMap.set(panel.id, { id: panel.id, name: panel.name });
    }
  }
  for (const legacy of legacyByDeviceId.values()) {
    if (!allPanelMap.has(legacy.id)) {
      allPanelMap.set(legacy.id, { id: legacy.id, name: legacy.name });
    }
  }
  const allKnownPanels = Array.from(allPanelMap.values());

  const activeDeviceIdsByPanelId = new Map<string, Set<string>>();
  const addActiveDevice = (panelId: string, deviceId: string) => {
    const set = activeDeviceIdsByPanelId.get(panelId) ?? new Set<string>();
    set.add(deviceId);
    activeDeviceIdsByPanelId.set(panelId, set);
  };
  let confirmedDevices = 0;
  let devicesWithoutPanel = 0;
  let devicesPendingConfirmation = 0;
  let firstDeviceWithoutPanelId: string | null = null;

  for (const device of allHouseholdDevices) {
    const validPanel = device.activePanelId
      ? (validPanelById.get(device.activePanelId) ?? null)
      : null;
    const hasValidVersion = Boolean(
      validPanel &&
        device.activePanelVersionId &&
        validVersionLayoutById.get(device.activePanelVersionId) === validPanel.id,
    );
    const sanitizedSummary: DeviceSummary = {
      id: device.id,
      name: device.name,
      lastSeenAt: null,
      appliedRevision: device.appliedRevision,
      activePanelId: hasValidVersion ? device.activePanelId : null,
      activePanelVersionId: hasValidVersion ? device.activePanelVersionId : null,
    };
    const legacyPanel = !device.activePanelId ? (legacyByDeviceId.get(device.id) ?? null) : null;
    const status = deriveDeviceActiveStatus({
      device: sanitizedSummary,
      activePanelName: validPanel?.name ?? null,
      legacyFallback: legacyPanel
        ? { status: "ready", publishedRevision: `online:${legacyPanel.publishedVersionId}` }
        : { status: "ready", publishedRevision: null },
    });

    if (status.kind === "confirmed") {
      confirmedDevices += 1;
      if (status.activePanelId) {
        addActiveDevice(status.activePanelId, device.id);
      }
    } else if (status.kind === "pending") {
      devicesPendingConfirmation += 1;
      if (status.activePanelId) {
        addActiveDevice(status.activePanelId, device.id);
      }
    } else if (status.kind === "legacy-active" && legacyPanel) {
      addActiveDevice(legacyPanel.id, device.id);
      if (status.appliedRevision && status.appliedRevision === status.sentRevision) {
        confirmedDevices += 1;
      } else {
        devicesPendingConfirmation += 1;
      }
    } else {
      devicesWithoutPanel += 1;
      if (!firstDeviceWithoutPanelId) {
        firstDeviceWithoutPanelId = device.id;
      }
    }
  }

  const deviceSummaries: DeviceSummary[] = deviceRows.map((device) => {
    const validPanel = device.activePanelId
      ? (validPanelById.get(device.activePanelId) ?? null)
      : null;
    const hasValidVersion = Boolean(
      validPanel &&
        device.activePanelVersionId &&
        validVersionLayoutById.get(device.activePanelVersionId) === validPanel.id,
    );
    return {
      id: device.id,
      name: device.name,
      timezone: device.timezone,
      lastSeenAt: device.lastSeenAt ? device.lastSeenAt.toISOString() : null,
      appliedRevision: device.appliedRevision,
      activePanelId: hasValidVersion ? device.activePanelId : null,
      activePanelVersionId: hasValidVersion ? device.activePanelVersionId : null,
    };
  });

  const devices: OverviewDeviceCard[] = deviceRows.map((device, index) => {
    const validPanel =
      deviceSummaries[index].activePanelId !== null
        ? (validPanelById.get(deviceSummaries[index].activePanelId!) ?? null)
        : null;
    const activePanel = validPanel ? { id: validPanel.id, name: validPanel.name } : null;
    const legacyPanel = !device.activePanelId ? (legacyByDeviceId.get(device.id) ?? null) : null;
    return mapOverviewDeviceCard({
      device: deviceSummaries[index],
      allDevices: deviceSummaries,
      activePanel,
      allPanels: allKnownPanels,
      legacyPanel,
      totalPanels,
    });
  });

  const panels: OverviewPanelCard[] = panelRows.map((panel) => {
    const hasValidPublishedVersion = Boolean(
      (panel.publishedVersionId &&
        validPublishedVersionLayoutById.get(panel.publishedVersionId) === panel.id) ||
        panelIdsWithAnyVersion.has(panel.id),
    );
    const activeIds = activeDeviceIdsByPanelId.get(panel.id) ?? new Set<string>();
    const availableIds = availableDeviceIdsByPanelId.get(panel.id) ?? new Set<string>();
    let extraAvailableDeviceCount = 0;
    for (const id of availableIds) {
      if (!activeIds.has(id)) extraAvailableDeviceCount += 1;
    }
    return mapOverviewPanelCard({
      panel: {
        id: panel.id,
        name: panel.name,
        draftRevision: panel.draftRevision,
        hasPublishedVersion: hasValidPublishedVersion,
        activeDeviceCount: activeIds.size,
        availableDeviceCount: availableIds.size,
        extraAvailableDeviceCount,
      },
      allPanels: allKnownPanels,
    });
  });

  const guidance = deriveOverviewGuidance({
    totalPanels,
    totalDevices,
    totalPhotos,
    readyPhotos,
    pendingPhotos,
    devicesWithoutPanel,
    devicesPendingConfirmation,
    firstPanelId: panels[0]?.id ?? null,
    firstDeviceWithoutPanelId,
  });

  return {
    totals: {
      devices: totalDevices,
      panels: totalPanels,
      photos: totalPhotos,
      readyPhotos,
      pendingPhotos,
      failedPhotos,
      confirmedDevices,
      devicesWithoutPanel,
      devicesPendingConfirmation,
    },
    devices,
    panels,
    recentPhotos,
    guidance,
  };
}

export async function getOverviewData(
  database: PrismaClient,
  householdId: string,
): Promise<OverviewData> {
  const client = database as OverviewDb;
  if (typeof client.$transaction === "function") {
    return client.$transaction((tx) => queryOverviewSnapshot(tx, householdId));
  }
  return queryOverviewSnapshot(client, householdId);
}
