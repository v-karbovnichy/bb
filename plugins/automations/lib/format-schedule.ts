import cronstrue from "cronstrue/i18n";
import type { AutomationTrigger } from "../src/rpc-types";

export const PERSONAL_PROJECT_ID = "proj_personal";

const SCHEDULE_RUN_FORMATTER = new Intl.DateTimeFormat("ru-RU", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

interface FormatScheduleStatusLabelArgs {
  enabled: boolean;
  nextRunAt: number | null;
  trigger?: AutomationTrigger;
  runCount?: number;
  lastRunStatus?: "running" | "succeeded" | "failed" | "skipped" | null;
  now?: number;
}

interface OverviewScheduleMetadata {
  isNextRun: boolean;
  text: string;
}

export type AutomationStatusFilter = "active" | "paused";

interface OneShotLifecycleArgs {
  enabled: boolean;
  trigger: AutomationTrigger;
  runCount: number;
  lastRunStatus: "running" | "succeeded" | "failed" | "skipped" | null;
  now?: number;
}

type OneShotLifecycle =
  | "scheduled"
  | "paused"
  | "expired"
  | "running"
  | "completed"
  | "failed"
  | "skipped";

function formatCronCadence(cron: string): string {
  try {
    return cronstrue.toString(cron, {
      locale: "ru",
      verbose: false,
      use24HourTimeFormat: true,
    });
  } catch {
    return "Пользовательское расписание";
  }
}

export function formatAutomationTrigger(trigger: AutomationTrigger): string {
  if (trigger.triggerType === "once") {
    return "Однократно";
  }
  return formatCronCadence(trigger.cron);
}

export function getOneShotLifecycle({
  enabled,
  trigger,
  runCount,
  lastRunStatus,
  now = Date.now(),
}: OneShotLifecycleArgs): OneShotLifecycle | null {
  if (trigger.triggerType !== "once") return null;
  if (enabled) return "scheduled";
  if (runCount > 0) {
    if (lastRunStatus === "running") return "running";
    if (lastRunStatus === "failed") return "failed";
    if (lastRunStatus === "skipped") return "skipped";
    return "completed";
  }
  return trigger.runAt <= now ? "expired" : "paused";
}

export function oneShotLifecycleAllowsToggle(
  lifecycle: OneShotLifecycle | null,
): boolean {
  return (
    lifecycle === null || lifecycle === "scheduled" || lifecycle === "paused"
  );
}

export function formatScheduleRunTime(timestamp: number): string {
  return SCHEDULE_RUN_FORMATTER.format(new Date(timestamp));
}

export function formatScheduleStatusLabel({
  enabled,
  nextRunAt,
  trigger,
  runCount = 0,
  lastRunStatus = null,
  now = Date.now(),
}: FormatScheduleStatusLabelArgs): string {
  if (trigger !== undefined) {
    const oneShotLifecycle = getOneShotLifecycle({
      enabled,
      trigger,
      runCount,
      lastRunStatus,
      now,
    });
    if (oneShotLifecycle === "running") return "Выполняется";
    if (oneShotLifecycle === "failed") return "Ошибка";
    if (oneShotLifecycle === "skipped") return "Пропущено";
    if (oneShotLifecycle === "completed") return "Завершено";
    if (oneShotLifecycle === "expired") return "Срок истёк — измените расписание";
  }
  if (!enabled) {
    return "Приостановлено";
  }
  if (nextRunAt === null) {
    return "Не запланировано";
  }
  return `Следующий запуск: ${formatScheduleRunTime(nextRunAt)}`;
}

export function formatOverviewScheduleMetadata(
  args: FormatScheduleStatusLabelArgs,
): OverviewScheduleMetadata | null {
  const label = formatScheduleStatusLabel(args);
  if (
    label === "Ошибка" ||
    label === "Приостановлено" ||
    label === "Завершено" ||
    label === "Срок истёк — измените расписание"
  ) {
    return null;
  }
  if (label.startsWith("Следующий запуск: ")) {
    return { isNextRun: true, text: label.slice("Следующий запуск: ".length) };
  }
  return { isNextRun: false, text: label };
}

export function formatDetailScheduleStatusLabel(
  args: FormatScheduleStatusLabelArgs,
): string | null {
  const label = formatScheduleStatusLabel(args);
  return label === "Приостановлено" || label === "Завершено" ? null : label;
}

export function matchesAutomationStatusFilters(
  automation: FormatScheduleStatusLabelArgs,
  filters: readonly AutomationStatusFilter[],
): boolean {
  if (filters.length === 0) return true;
  if (automation.enabled) return filters.includes("active");
  if (automation.trigger?.triggerType !== "once") {
    return filters.includes("paused");
  }
  const lifecycle = getOneShotLifecycle({
    enabled: automation.enabled,
    trigger: automation.trigger,
    runCount: automation.runCount ?? 0,
    lastRunStatus: automation.lastRunStatus ?? null,
    now: automation.now,
  });
  if (lifecycle === "running") return filters.includes("active");
  if (lifecycle === "paused" || lifecycle === "completed") {
    return filters.includes("paused");
  }
  return false;
}
