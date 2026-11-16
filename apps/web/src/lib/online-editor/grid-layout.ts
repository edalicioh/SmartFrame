import {
  autoArrangeDashboardGrid,
  createDefaultDashboardGridLayout,
  dashboardWidgetKeys,
  gridDimensions,
  gridItemsOverlap,
  gridWidgetCatalog,
  resolveActivePageConfig,
  type DashboardGridItem,
  type DashboardGridLayout,
  type DashboardWidgetKey,
  type OnlineDashboard,
  type SmartStackConfig,
} from "@smartframe/contracts";

type Orientation = "landscape" | "portrait";

/** Change one scope's grid mode without leaving an incompatible active stack. */
export function setGridLayoutEnabled(
  config: OnlineDashboard,
  enabled: boolean,
  pageId?: string,
): OnlineDashboard {
  const scope = resolveActivePageConfig(config, pageId);
  const patch = {
    gridLayout: {
      ...(scope.gridLayout ?? createDefaultDashboardGridLayout(config)),
      enabled,
    },
    ...(!enabled && scope.smartStack?.enabled
      ? { smartStack: { ...scope.smartStack, enabled: false } }
      : {}),
  };
  if (scope.page && config.pages) {
    const targetId = scope.page.id;
    return {
      ...config,
      pages: config.pages.map((page) => (page.id === targetId ? { ...page, ...patch } : page)),
    };
  }
  return { ...config, ...patch };
}

function stackSetForScope(
  enabledSet: Set<DashboardWidgetKey>,
  smartStack?: SmartStackConfig,
): Set<DashboardWidgetKey> | null {
  if (!smartStack?.enabled) return null;
  const active = smartStack.widgets.filter((key) => enabledSet.has(key));
  return active.length >= 2 ? new Set(active) : null;
}

function hasActiveOverlap(
  items: readonly DashboardGridItem[],
  enabledSet: Set<DashboardWidgetKey>,
  stackSet: Set<DashboardWidgetKey> | null,
): boolean {
  const active = items.filter((item) => enabledSet.has(item.widgetId));
  const stackAnchor = stackSet
    ? items.find((item) => item.widgetId === [...stackSet][0])
    : undefined;
  const effectiveItem = (item: DashboardGridItem) =>
    stackSet && stackSet.has(item.widgetId) && stackAnchor
      ? { ...stackAnchor, widgetId: item.widgetId }
      : item;
  return active.some((item, index) =>
    active.slice(0, index).some((other) => {
      if (stackSet && stackSet.has(item.widgetId) && stackSet.has(other.widgetId)) return false;
      return gridItemsOverlap(effectiveItem(item), effectiveItem(other));
    }),
  );
}

/**
 * The player draws every stack member inside the first active member's box.
 * That anchor must therefore satisfy the largest minimum size in the stack,
 * even when the members still have their old individual boxes.
 */
function stackAnchorNeedsRepair(
  items: readonly DashboardGridItem[],
  stackSet: Set<DashboardWidgetKey> | null,
): boolean {
  if (!stackSet) return false;
  const stackKeys = [...stackSet];
  const anchor = items.find((item) => item.widgetId === stackKeys[0]);
  if (!anchor) return true;
  return stackKeys.some((key) => {
    const minimum = gridWidgetCatalog[key];
    return anchor.w < minimum.minWidth || anchor.h < minimum.minHeight;
  });
}

/**
 * An orientation is usable only when every enabled widget has a valid stored
 * position, Smart Stack members share an anchor large enough for all their
 * minimums, and none of the other positions overlap. Stored items for disabled
 * widgets are left untouched.
 */
function orientationNeedsRepair(
  gridLayout: DashboardGridLayout,
  orientation: Orientation,
  enabledKeys: readonly DashboardWidgetKey[],
  smartStack?: SmartStackConfig,
): boolean {
  const items = gridLayout[orientation];
  const { columns, rows } = gridDimensions[orientation];
  const enabledSet = new Set(enabledKeys);
  const stackSet = stackSetForScope(enabledSet, smartStack);
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
  return (
    missingOrInvalid ||
    stackAnchorNeedsRepair(items, stackSet) ||
    hasActiveOverlap(items, enabledSet, stackSet)
  );
}

/**
 * Repair the orientations that cannot be validated, leaving untouched ones
 * exactly as stored. Both orientations are arranged in a single call so the
 * result is produced from one consistent draft; the draft itself is not
 * validated here because other fields may still be mid-edit.
 */
export function ensureGridLayoutValid(next: OnlineDashboard): OnlineDashboard {
  let result = next;
  if (result.gridLayout?.enabled) {
    const enabledKeys = dashboardWidgetKeys.filter((key) => result.widgets[key].enabled);
    const needsLandscape = orientationNeedsRepair(
      result.gridLayout,
      "landscape",
      enabledKeys,
      result.smartStack,
    );
    const needsPortrait = orientationNeedsRepair(
      result.gridLayout,
      "portrait",
      enabledKeys,
      result.smartStack,
    );
    if (needsLandscape && needsPortrait) result = autoArrangeDashboardGrid(result);
    else if (needsLandscape) result = autoArrangeDashboardGrid(result, "landscape");
    else if (needsPortrait) result = autoArrangeDashboardGrid(result, "portrait");
  }
  if (result.pages?.length) {
    for (const page of result.pages) {
      // A page without its own grid uses the dashboard grid. Validate that
      // effective grid and materialize a page-specific repair when the page's
      // widget set or stack no longer fits the inherited positions.
      const gridLayout = page.gridLayout ?? result.gridLayout;
      if (!gridLayout?.enabled) continue;
      const stack = page.smartStack ?? result.smartStack;
      const needsLandscape = orientationNeedsRepair(
        gridLayout,
        "landscape",
        page.enabledWidgets,
        stack,
      );
      const needsPortrait = orientationNeedsRepair(
        gridLayout,
        "portrait",
        page.enabledWidgets,
        stack,
      );
      if (needsLandscape && needsPortrait) {
        result = autoArrangeDashboardGrid(result, undefined, page.id);
      } else if (needsLandscape) {
        result = autoArrangeDashboardGrid(result, "landscape", page.id);
      } else if (needsPortrait) {
        result = autoArrangeDashboardGrid(result, "portrait", page.id);
      }
    }
  }
  return result;
}
