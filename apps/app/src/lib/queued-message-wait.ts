import {
  RESTART_RESUME_RETRY_REASON,
  type QueuedMessagePayload,
  type QueuedMessageWaitingOn,
  type ThreadStatus,
} from "@bb/domain";
import type { IconName } from "@bb/shared-ui/icon";
import { formatScheduledTime } from "@/lib/relative-time";

const SUPERSEDED_WAIT_LINE = "Не отправлено · после него отправлено более новое сообщение";
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export function formatQueuedMessageCountdown(
  remainingMs: number,
): string | null {
  if (remainingMs <= 0) return null;
  if (remainingMs < MINUTE_MS) {
    return `через ${Math.ceil(remainingMs / 1000)} с`;
  }
  if (remainingMs < HOUR_MS) {
    return `через ${Math.floor(remainingMs / MINUTE_MS)} мин`;
  }
  if (remainingMs < DAY_MS) {
    return `через ${Math.floor(remainingMs / HOUR_MS)} ч`;
  }
  return `через ${Math.floor(remainingMs / DAY_MS)} дн`;
}

export function isQueuedMessageSendNowAllowed({
  waitingOn,
  failureReason,
}: {
  waitingOn: QueuedMessageWaitingOn | null;
  failureReason: string | null;
}): boolean {
  if (failureReason !== null) return true;
  if (waitingOn === null) return true;
  switch (waitingOn.kind) {
    case "provisioning":
    case "host-offline":
    case "interaction":
    case "turn-starting":
    case "app-update":
      return false;
    case "stopping":
      return false;
    case "time":
    case "plugin":
    case "thread-busy":
    case "superseded":
      return true;
  }
}

export function queuedMessageHasWaitLine(args: {
  failureReason: string | null;
  payload: QueuedMessagePayload;
  waitingOn: QueuedMessageWaitingOn | null;
}): boolean {
  if (args.failureReason !== null) return true;
  if (args.payload.kind === "retry") return true;
  if (args.waitingOn === null) return false;
  return args.waitingOn.kind !== "thread-busy";
}

export function queuedMessageWaitIcon(args: {
  failureReason: string | null;
  payload: QueuedMessagePayload;
  waitingOn: QueuedMessageWaitingOn | null;
}): IconName | null {
  if (args.failureReason !== null) return "AlertCircle";
  if (args.waitingOn?.kind === "superseded") return "AlertCircle";
  if (args.payload.kind === "retry") return "RotateCcw";
  if (args.waitingOn === null) return null;
  switch (args.waitingOn.kind) {
    case "thread-busy":
      return null;
    case "stopping":
    case "turn-starting":
      return "TimeSchedule";
    case "time":
      return "TimeSchedule";
    case "provisioning":
      return "Folder";
    case "host-offline":
      return "CloudOff";
    case "interaction":
      return "CircleQuestion";
    case "app-update":
      return "Download";
    case "plugin":
      return null;
  }
}

export interface DescribeQueuedMessageWaitArgs {
  failureReason: string | null;
  now: number;
  payload: QueuedMessagePayload;
  pluginDisplayName: string | null;
  sendAt: number | null;
  threadStatus: ThreadStatus;
  waitingOn: QueuedMessageWaitingOn | null;
}

export function queuedMessageFallbackTitle(args: {
  createdAt: number;
  now: number;
  payload: QueuedMessagePayload;
}): string {
  if (args.payload.kind !== "retry") return "Сообщение в очереди";
  if (args.payload.reason === RESTART_RESUME_RETRY_REASON) {
    return "Продолжить после перезапуска";
  }
  return `Повторить неудачный ответ от ${formatScheduledTime({
    now: args.now,
    timestamp: args.createdAt,
  })}`;
}

export function describeQueuedMessageWait(
  args: DescribeQueuedMessageWaitArgs,
): string | null {
  if (args.failureReason !== null) return args.failureReason;
  if (args.waitingOn?.kind === "superseded") return SUPERSEDED_WAIT_LINE;

  if (args.payload.kind === "retry") {
    const resume = args.payload.reason === RESTART_RESUME_RETRY_REASON;
    const parts: string[] = resume ? [] : [args.payload.reason];
    if (args.waitingOn?.kind === "plugin") {
      parts.push(
        `Удерживает ${args.pluginDisplayName ?? args.waitingOn.pluginId} · ${args.waitingOn.reason}`,
      );
    }
    if (args.sendAt !== null) {
      parts.push(
        `${resume ? "Продолжение" : "Повторная попытка"} в ${formatScheduledTime({ now: args.now, timestamp: args.sendAt })}`,
      );
    }
    parts.push(`попытка ${args.payload.attempt}`);
    return parts.join(" · ");
  }

  if (!queuedMessageHasWaitLine(args)) return null;
  if (args.waitingOn === null) return null;
  switch (args.waitingOn.kind) {
    case "thread-busy":
      return null;
    case "turn-starting":
      return args.threadStatus === "error"
        ? "Ответ не начался · отправится при следующем ответе"
        : "Ожидание начала ответа";
    case "stopping":
      return "Отправится после остановки чата";
    case "time":
      return args.sendAt === null
        ? "Запланировано"
        : `Запланировано на ${formatScheduledTime({ now: args.now, timestamp: args.sendAt })}`;
    case "provisioning":
      return "Ожидание рабочего пространства";
    case "host-offline":
      return `Ожидание готовности ${args.waitingOn.hostName}`;
    case "interaction":
      return "Ожидание вашего ответа";
    case "app-update":
      return "Отправится после перезапуска bb для обновления";
    case "plugin":
      return `Удерживает ${args.pluginDisplayName ?? args.waitingOn.pluginId} · ${args.waitingOn.reason}`;
  }
}

export function queuedMessageCountdownInstant(args: {
  payload: QueuedMessagePayload;
  sendAt: number | null;
  waitingOn: QueuedMessageWaitingOn | null;
}): number | null {
  if (args.payload.kind === "retry") return null;
  if (args.waitingOn === null || args.waitingOn.kind !== "time") return null;
  return args.sendAt;
}
