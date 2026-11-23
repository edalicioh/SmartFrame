import { z } from "zod";

export const notificationSeverities = ["info", "success", "warning", "alert"] as const;
export type NotificationSeverity = (typeof notificationSeverities)[number];
export const notificationSeveritySchema = z.enum(notificationSeverities);

export const pushStatuses = ["healthy", "running", "warning", "failing", "idle"] as const;
export type PushStatus = (typeof pushStatuses)[number];
export const pushStatusSchema = z.enum(pushStatuses);

export const pushKeyRegex = /^[A-Za-z0-9_-]{1,64}$/;
export const timeHhMmRegex = /^([01]\d|2[0-3]):[0-5]\d$/;

export const ruleTriggerSchema = z
  .discriminatedUnion("type", [
    z
      .object({
        type: z.literal("push_event"),
        feedKey: z.string().regex(pushKeyRegex, "Chave de feed inválida"),
        status: pushStatusSchema.optional(),
      })
      .strict(),
    z
      .object({
        type: z.literal("notify_event"),
        minSeverity: notificationSeveritySchema.default("warning"),
      })
      .strict(),
    z
      .object({
        type: z.literal("time_range"),
        startTime: z.string().regex(timeHhMmRegex, "Horário inicial inválido"),
        endTime: z.string().regex(timeHhMmRegex, "Horário final inválido"),
        daysOfWeek: z
          .array(z.number().int().min(0).max(6))
          .min(1)
          .max(7)
          .refine((days) => new Set(days).size === days.length, "Dias da semana duplicados")
          .default([1, 2, 3, 4, 5]),
      })
      .strict(),
  ])
  .refine((trigger) => trigger.type !== "time_range" || trigger.startTime !== trigger.endTime, {
    message: "Horário de início e fim devem ser diferentes",
    path: ["endTime"],
  });

export type RuleTrigger = z.infer<typeof ruleTriggerSchema>;

export const ruleActionSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("goto_page"),
      pageId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "ID de página inválido"),
      durationSeconds: z.number().int().min(0).max(3600).default(0),
    })
    .strict(),
  z
    .object({
      type: z.literal("show_notification"),
      title: z.string().trim().max(80).default("Alerta automático"),
      message: z.string().trim().min(1).max(300),
      severity: notificationSeveritySchema.default("warning"),
      durationSeconds: z.number().int().min(3).max(120).default(8),
    })
    .strict(),
]);

export type RuleAction = z.infer<typeof ruleActionSchema>;

export const dashboardRuleSchema = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    name: z.string().trim().min(1).max(80),
    enabled: z.boolean().default(true),
    trigger: ruleTriggerSchema,
    action: ruleActionSchema,
  })
  .strict();

export type DashboardRule = z.infer<typeof dashboardRuleSchema>;

export function scheduleRuleDurationSeconds(
  trigger: Extract<RuleTrigger, { type: "time_range" }>,
): number {
  const [startH, startM] = trigger.startTime.split(":").map(Number);
  const [endH, endM] = trigger.endTime.split(":").map(Number);
  return ((endH * 60 + endM - (startH * 60 + startM) + 1440) % 1440) * 60;
}

export function isScheduleRulePollSafe(
  rule: Pick<DashboardRule, "trigger">,
  refreshSeconds: number,
): boolean {
  if (rule.trigger.type !== "time_range") return true;
  return scheduleRuleDurationSeconds(rule.trigger) >= refreshSeconds;
}

/** Exclude schedule windows that a polling player could miss entirely. */
export function filterPollSafeScheduleRules(
  rules: readonly DashboardRule[] | undefined,
  refreshSeconds: number,
): DashboardRule[] {
  return (rules ?? []).filter((rule) => isScheduleRulePollSafe(rule, refreshSeconds));
}

export type RuleEvent =
  | { type: "push_event"; feedKey: string; status?: PushStatus }
  | { type: "notify_event"; severity: NotificationSeverity };

const SEVERITY_RANK: Record<NotificationSeverity, number> = {
  info: 0,
  success: 1,
  warning: 2,
  alert: 3,
};

/** Evaluate event-driven rules deterministically in declaration order. */
export function evaluateEventRules(
  rules: readonly DashboardRule[] | undefined,
  event: RuleEvent,
): DashboardRule[] {
  if (!rules?.length) return [];
  return rules.filter((rule) => {
    if (!rule.enabled) return false;
    if (event.type === "push_event" && rule.trigger.type === "push_event") {
      if (rule.trigger.feedKey !== event.feedKey) return false;
      return !rule.trigger.status || rule.trigger.status === event.status;
    }
    if (event.type === "notify_event" && rule.trigger.type === "notify_event") {
      return SEVERITY_RANK[event.severity] >= SEVERITY_RANK[rule.trigger.minSeverity];
    }
    return false;
  });
}

const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function toMinutes(hhmm: string): number {
  const [hours, minutes] = hhmm.split(":").map(Number);
  return hours * 60 + minutes;
}

function localTimeParts(now: Date, timezone: string) {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone || "America/Sao_Paulo",
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
  }
  const map: Record<string, string> = {};
  for (const part of formatter.formatToParts(now)) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  const hour = Number(map.hour) === 24 ? 0 : Number(map.hour);
  const minute = Number(map.minute);
  const year = Number(map.year);
  const month = Number(map.month);
  const day = Number(map.day);
  const weekday = WEEKDAY_MAP[map.weekday] ?? 0;
  return {
    weekday,
    year,
    month,
    day,
    nowMinutes: hour * 60 + minute,
    dateIso: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  };
}

function resolveActiveScheduleWindow(
  trigger: Extract<RuleTrigger, { type: "time_range" }>,
  local: ReturnType<typeof localTimeParts>,
  prevWeekday: number,
  prevDateIso: string,
): string | null {
  const startMinutes = toMinutes(trigger.startTime);
  const endMinutes = toMinutes(trigger.endTime);

  if (startMinutes < endMinutes) {
    if (
      trigger.daysOfWeek.includes(local.weekday) &&
      local.nowMinutes >= startMinutes &&
      local.nowMinutes < endMinutes
    ) {
      return local.dateIso;
    }
  } else if (startMinutes > endMinutes) {
    // Overnight schedule: e.g. 22:00..06:00 uses today's date from 22:00 and yesterday's before 06:00.
    if (local.nowMinutes >= startMinutes && trigger.daysOfWeek.includes(local.weekday)) {
      return local.dateIso;
    }
    if (local.nowMinutes < endMinutes && trigger.daysOfWeek.includes(prevWeekday)) {
      return prevDateIso;
    }
  }

  return null;
}

export type ScheduleRuleMatch = {
  rule: DashboardRule;
  pageId: string;
  durationSeconds: number;
  directiveId: string;
};

export type ScheduledNotificationMatch = {
  rule: DashboardRule;
  id: string;
  title: string | null;
  message: string;
  severity: NotificationSeverity;
  durationSeconds: number;
};

/** Evaluate active time_range -> goto_page rules in the target timezone. */
export function evaluateScheduleRules(
  rules: readonly DashboardRule[] | undefined,
  now: Date,
  timezone: string,
): ScheduleRuleMatch | null {
  if (!rules?.length) return null;
  const local = localTimeParts(now, timezone);
  const prevWeekday = (local.weekday + 6) % 7;
  const prevDateIso = new Date(Date.UTC(local.year, local.month - 1, local.day - 1))
    .toISOString()
    .slice(0, 10);

  for (const rule of rules) {
    if (!rule.enabled || rule.trigger.type !== "time_range" || rule.action.type !== "goto_page") {
      continue;
    }
    const activeWindowDate = resolveActiveScheduleWindow(
      rule.trigger,
      local,
      prevWeekday,
      prevDateIso,
    );
    if (activeWindowDate) {
      return {
        rule,
        pageId: rule.action.pageId,
        durationSeconds: rule.action.durationSeconds,
        directiveId: `schedule:${rule.id}:${activeWindowDate}:${rule.trigger.startTime}-${rule.trigger.endTime}`,
      };
    }
  }
  return null;
}

/** Evaluate active time_range -> show_notification rules in the target timezone. */
export function evaluateScheduleNotifications(
  rules: readonly DashboardRule[] | undefined,
  now: Date,
  timezone: string,
): ScheduledNotificationMatch[] {
  if (!rules?.length) return [];
  const local = localTimeParts(now, timezone);
  const prevWeekday = (local.weekday + 6) % 7;
  const prevDateIso = new Date(Date.UTC(local.year, local.month - 1, local.day - 1))
    .toISOString()
    .slice(0, 10);

  const matches: ScheduledNotificationMatch[] = [];
  for (const rule of rules) {
    if (
      !rule.enabled ||
      rule.trigger.type !== "time_range" ||
      rule.action.type !== "show_notification"
    ) {
      continue;
    }
    const activeWindowDate = resolveActiveScheduleWindow(
      rule.trigger,
      local,
      prevWeekday,
      prevDateIso,
    );
    if (activeWindowDate) {
      matches.push({
        rule,
        id: `schedule:${rule.id}:${activeWindowDate}:${rule.trigger.startTime}-${rule.trigger.endTime}`,
        title: rule.action.title.trim() || null,
        message: rule.action.message,
        severity: rule.action.severity,
        durationSeconds: rule.action.durationSeconds,
      });
    }
  }
  return matches;
}
