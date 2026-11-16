type Widgets = Record<string, { enabled: boolean }>;

/** Numeric field IDs are prefixed with the widget key, e.g. `birthdays.day.<id>`. */
export function widgetKeyFromNumericIssue(id: string): string {
  const separator = id.indexOf(".");
  return separator === -1 ? id : id.slice(0, separator);
}

/**
 * Local widgets render their numeric fields only while enabled, so disabling
 * one unmounts the field and its draft value. Their pending errors must be
 * dropped or they would keep blocking save and publish invisibly.
 * Other widgets (photos, currencies, panel refresh) keep their fields mounted
 * when disabled; retaining the pending error prevents saving with a stale
 * value that is still visible in the field.
 */
const UNMOUNTED_NUMERIC_WIDGETS = new Set(["notes", "countdown", "birthdays", "tasks", "pomodoro"]);

export function clearNumericIssuesForDisabledWidgets(
  issues: Record<string, string>,
  previous: Widgets,
  next: Widgets,
): Record<string, string> {
  const unmounted = new Set(
    Object.keys(next).filter(
      (key) => UNMOUNTED_NUMERIC_WIDGETS.has(key) && previous[key]?.enabled && !next[key].enabled,
    ),
  );
  if (!unmounted.size) return issues;
  const remaining = Object.entries(issues).filter(
    ([id]) => !unmounted.has(widgetKeyFromNumericIssue(id)),
  );
  if (remaining.length === Object.keys(issues).length) return issues;
  return Object.fromEntries(remaining);
}

export function clearNumericIssuesForHiddenWidgets(
  issues: Record<string, string>,
  visibleWidgetKeys: ReadonlySet<string>,
): Record<string, string> {
  const remaining = Object.entries(issues).filter(([id]) => {
    const key = widgetKeyFromNumericIssue(id);
    return !UNMOUNTED_NUMERIC_WIDGETS.has(key) || visibleWidgetKeys.has(key);
  });
  if (remaining.length === Object.keys(issues).length) return issues;
  return Object.fromEntries(remaining);
}
