import {
  autoArrangeDashboardGrid,
  dashboardWidgetKeys,
  gridDimensions,
  gridItemsOverlap,
  gridWidgetCatalog,
  type DashboardGridItem,
  type OnlineDashboard,
} from "@smartframe/contracts";

type Orientation = "landscape" | "portrait";

function hasActiveOverlap(items: readonly DashboardGridItem[], config: OnlineDashboard): boolean {
  const active = items.filter((item) => config.widgets[item.widgetId].enabled);
  return active.some((item, index) =>
    active.slice(0, index).some((other) => gridItemsOverlap(item, other)),
  );
}

/**
 * An orientation is usable only when every enabled widget has a valid stored
 * position and none of those positions overlap. Stored items for disabled
 * widgets are left untouched.
 */
function orientationNeedsRepair(
  config: OnlineDashboard,
  orientation: Orientation,
  enabledKeys: readonly (typeof dashboardWidgetKeys)[number][],
): boolean {
  const items = config.gridLayout![orientation];
  const { columns, rows } = gridDimensions[orientation];
  const missingOrInvalid = enabledKeys.some((key) => {
    const item = items.find((entry) => entry.widgetId === key);
    if (!item) return true;
    const minimum = gridWidgetCatalog[key];
    return (
      item.x + item.w > columns ||
      item.y + item.h > rows ||
      item.w < minimum.minWidth ||
      item.h < minimum.minHeight
    );
  });
  return missingOrInvalid || hasActiveOverlap(items, config);
}

/**
 * Repair the orientations that cannot be validated, leaving untouched ones
 * exactly as stored. Both orientations are arranged in a single call so the
 * result is produced from one consistent draft; the draft itself is not
 * validated here because other fields may still be mid-edit.
 */
export function ensureGridLayoutValid(next: OnlineDashboard): OnlineDashboard {
  if (!next.gridLayout?.enabled) return next;
  const enabledKeys = dashboardWidgetKeys.filter((key) => next.widgets[key].enabled);
  const needsLandscape = orientationNeedsRepair(next, "landscape", enabledKeys);
  const needsPortrait = orientationNeedsRepair(next, "portrait", enabledKeys);
  if (!needsLandscape && !needsPortrait) return next;
  if (needsLandscape && needsPortrait) return autoArrangeDashboardGrid(next);
  return autoArrangeDashboardGrid(next, needsLandscape ? "landscape" : "portrait");
}
