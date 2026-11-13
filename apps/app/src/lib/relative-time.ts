interface FormatRelativeTimeArgs {
  timestamp: number;
  now: number;
}

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
const RELATIVE_FORMATTER = new Intl.RelativeTimeFormat("ru", { style: "short" });

export function formatRelativeTime({
  timestamp,
  now,
}: FormatRelativeTimeArgs): string {
  const diffMs = now - timestamp;
  if (diffMs < MINUTE_MS) {
    return "только что";
  }
  if (diffMs < HOUR_MS) {
    return RELATIVE_FORMATTER.format(-Math.floor(diffMs / MINUTE_MS), "minute");
  }
  if (diffMs < DAY_MS) {
    return RELATIVE_FORMATTER.format(-Math.floor(diffMs / HOUR_MS), "hour");
  }
  const days = Math.floor(diffMs / DAY_MS);
  if (days === 1) {
    return "Вчера";
  }
  if (diffMs < WEEK_MS) {
    return RELATIVE_FORMATTER.format(-days, "day");
  }
  if (diffMs < 5 * WEEK_MS) {
    return RELATIVE_FORMATTER.format(-Math.floor(diffMs / WEEK_MS), "week");
  }
  return new Date(timestamp).toLocaleDateString("ru", {
    month: "short",
    day: "numeric",
  });
}

interface FormatScheduledTimeArgs {
  timestamp: number;
  now: number;
}

export function formatScheduledTime({
  timestamp,
  now,
}: FormatScheduledTimeArgs): string {
  const target = new Date(timestamp);
  const clock = target.toLocaleTimeString("ru", {
    hour: "numeric",
    minute: "2-digit",
  });
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfTarget = new Date(timestamp);
  startOfTarget.setHours(0, 0, 0, 0);
  const daysAhead = Math.round(
    (startOfTarget.getTime() - startOfToday.getTime()) / DAY_MS,
  );
  if (daysAhead === 0) {
    return clock;
  }
  if (daysAhead === 1) {
    return `Завтра ${clock}`;
  }
  const date = target.toLocaleDateString("ru", {
    month: "short",
    day: "numeric",
  });
  return `${date} ${clock}`;
}
