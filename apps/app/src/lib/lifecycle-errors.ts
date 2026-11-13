import { assertNever } from "@bb/core-ui";
import { BbHttpError } from "@bb/sdk/browser";
import {
  lifecycleApiErrorSchema,
  type LifecycleApiError,
} from "@bb/server-contract";
import { HttpError } from "./api";

type LifecycleErrorSeverity = "info" | "warning" | "error";
export type LifecycleErrorOperation =
  | "archive_thread"
  | "create_thread"
  | "edit_message"
  | "load_diff"
  | "load_git_status"
  | "load_thread_storage"
  | "open_terminal"
  | "queue_message"
  | "reorder_queued_message"
  | "resolve_interaction"
  | "send_message"
  | "send_queued_message"
  | "set_queued_message_group_boundary"
  | "stop_thread"
  | "update_queued_message"
  | "update_merge_base";

export interface LifecycleErrorDescription {
  body: string;
  severity: LifecycleErrorSeverity;
  title: string;
}

interface DescribeLifecycleErrorOptions {
  error: unknown;
  operation?: LifecycleErrorOperation | undefined;
}

interface LifecycleDescriptionArgs {
  body: string;
  operation?: LifecycleErrorOperation | undefined;
  severity: LifecycleErrorSeverity;
  title: string;
}

interface LifecycleDescriptionWithoutSeverityArgs {
  body: string;
  operation?: LifecycleErrorOperation | undefined;
  title: string;
}

interface EnvironmentNotReadyDescriptionArgs {
  error: Extract<LifecycleApiError, { code: "environment_not_ready" }>;
  operation?: LifecycleErrorOperation | undefined;
}

interface ThreadEnvironmentUnavailableDescriptionArgs {
  error: Extract<LifecycleApiError, { code: "thread_environment_unavailable" }>;
  operation?: LifecycleErrorOperation | undefined;
}

interface ThreadNotWritableDescriptionArgs {
  error: Extract<LifecycleApiError, { code: "thread_not_writable" }>;
  operation?: LifecycleErrorOperation | undefined;
}

interface HostUnavailableDescriptionArgs {
  error: Extract<LifecycleApiError, { code: "host_unavailable" }>;
  operation?: LifecycleErrorOperation | undefined;
}

interface ProjectUnavailableDescriptionArgs {
  error: Extract<LifecycleApiError, { code: "project_unavailable" }>;
  operation?: LifecycleErrorOperation | undefined;
}

interface ParentThreadInvalidDescriptionArgs {
  error: Extract<LifecycleApiError, { code: "parent_thread_invalid" }>;
  operation?: LifecycleErrorOperation | undefined;
}

interface DispatchRejectedDescriptionArgs {
  error: Extract<LifecycleApiError, { code: "dispatch_rejected" }>;
  operation?: LifecycleErrorOperation | undefined;
}

interface DispatchHookFailedDescriptionArgs {
  error: Extract<LifecycleApiError, { code: "dispatch_hook_failed" }>;
  operation?: LifecycleErrorOperation | undefined;
}

function operationTitle(operation: LifecycleErrorOperation): string {
  switch (operation) {
    case "archive_thread":
      return "Не удалось архивировать чат";
    case "create_thread":
      return "Не удалось создать чат";
    case "edit_message":
      return "Не удалось изменить сообщение";
    case "load_diff":
      return "Не удалось загрузить изменения";
    case "load_git_status":
      return "Статус рабочего пространства недоступен";
    case "load_thread_storage":
      return "Не удалось загрузить файлы чата";
    case "open_terminal":
      return "Не удалось открыть терминал";
    case "queue_message":
      return "Не удалось добавить сообщение в очередь";
    case "reorder_queued_message":
      return "Не удалось изменить порядок сообщений в очереди";
    case "resolve_interaction":
      return "Не удалось отправить ответ";
    case "send_message":
      return "Не удалось отправить сообщение";
    case "send_queued_message":
      return "Не удалось отправить сообщение из очереди";
    case "set_queued_message_group_boundary":
      return "Не удалось сгруппировать сообщения в очереди";
    case "stop_thread":
      return "Не удалось остановить чат";
    case "update_queued_message":
      return "Не удалось обновить сообщение в очереди";
    case "update_merge_base":
      return "Не удалось обновить базу слияния";
    default:
      return assertNever(operation);
  }
}

function lifecycleDescription({
  body,
  operation,
  severity,
  title,
}: LifecycleDescriptionArgs): LifecycleErrorDescription {
  return {
    title: operation ? operationTitle(operation) : title,
    body,
    severity,
  };
}

function info({
  body,
  operation,
  title,
}: LifecycleDescriptionWithoutSeverityArgs): LifecycleErrorDescription {
  return lifecycleDescription({ title, body, operation, severity: "info" });
}

function warning({
  body,
  operation,
  title,
}: LifecycleDescriptionWithoutSeverityArgs): LifecycleErrorDescription {
  return lifecycleDescription({ title, body, operation, severity: "warning" });
}

function errorDescription({
  body,
  operation,
  title,
}: LifecycleDescriptionWithoutSeverityArgs): LifecycleErrorDescription {
  return lifecycleDescription({ title, body, operation, severity: "error" });
}

function describeEnvironmentNotReady({
  error,
  operation,
}: EnvironmentNotReadyDescriptionArgs): LifecycleErrorDescription {
  const { details } = error;
  switch (details.environmentStatus) {
    case "creating":
    case "provisioning":
      return info({
        operation,
        title: "Рабочее пространство запускается",
        body: "Рабочее пространство ещё запускается.",
      });
    case "ready":
      return warning({
        operation,
        title: "Рабочее пространство недоступно",
        body: "Рабочее пространство недоступно.",
      });
    case "error":
      return errorDescription({
        operation,
        title: "Не удалось настроить рабочее пространство",
        body: "Не удалось настроить рабочее пространство.",
      });
    case "destroyed":
      return warning({
        operation,
        title: "Рабочее пространство недоступно",
        body: "Рабочее пространство больше не существует.",
      });
    default:
      return assertNever(details.environmentStatus);
  }
}

function describeThreadEnvironmentUnavailable({
  error,
  operation,
}: ThreadEnvironmentUnavailableDescriptionArgs): LifecycleErrorDescription {
  const { details } = error;
  switch (details.reason) {
    case "never_attached":
      return info({
        operation,
        title: "Рабочее пространство недоступно",
        body: "Рабочее пространство пока недоступно.",
      });
    case "destroyed":
      return warning({
        operation,
        title: "Рабочее пространство недоступно",
        body: "Рабочее пространство больше не существует.",
      });
    case "provisioning":
      return info({
        operation,
        title: "Рабочее пространство запускается",
        body: "Рабочее пространство ещё запускается.",
      });
    case "errored":
      return errorDescription({
        operation,
        title: "Не удалось настроить рабочее пространство",
        body: "Не удалось настроить рабочее пространство.",
      });
    default:
      return assertNever(details.reason);
  }
}

function describeThreadNotWritable({
  error,
  operation,
}: ThreadNotWritableDescriptionArgs): LifecycleErrorDescription {
  const { details } = error;
  switch (details.reason) {
    case "archived":
      return info({
        operation,
        title: "Чат архивирован",
        body: "Сначала извлеките чат из архива.",
      });
    case "stopping":
      return warning({
        operation,
        title: "Чат останавливается",
        body: "Чат останавливается.",
      });
    case "deleted":
      return errorDescription({
        operation,
        title: "Чат удалён",
        body: "Этот чат удалён.",
      });
    case "not_started":
      return info({
        operation,
        title: "Чат запускается",
        body: "Чат ещё запускается.",
      });
    case "not_active":
      return warning({
        operation,
        title: "Чат не запущен",
        body: "Чат не запущен.",
      });
    case "errored":
      return errorDescription({
        operation,
        title: "Ошибка чата",
        body: "В этом чате произошла ошибка; продолжить его нельзя.",
      });
    case "already_active":
      return warning({
        operation,
        title: "Чат уже работает",
        body: "Чат уже работает.",
      });
    case "still_starting":
      return info({
        operation,
        title: "Чат запускается",
        body: "Чат ещё запускается.",
      });
    default:
      return assertNever(details.reason);
  }
}

function describeHostUnavailable({
  error,
  operation,
}: HostUnavailableDescriptionArgs): LifecycleErrorDescription {
  const { details } = error;
  switch (details.reason) {
    case "suspended":
      return warning({
        operation,
        title: "Компьютер приостановлен",
        body: "Компьютер приостановлен.",
      });
    case "disconnected":
      return warning({
        operation,
        title: "Компьютер не в сети",
        body: "Компьютер не в сети.",
      });
    case "destroyed":
      return errorDescription({
        operation,
        title: "Компьютер удалён",
        body: "Компьютер удалён.",
      });
    default:
      return assertNever(details.reason);
  }
}

function describeProjectUnavailable({
  error,
  operation,
}: ProjectUnavailableDescriptionArgs): LifecycleErrorDescription {
  switch (error.details.reason) {
    case "pending_deletion":
      return info({
        operation,
        title: "Проект удаляется",
        body: "Этот проект удаляется.",
      });
    case "deleted":
      return errorDescription({
        operation,
        title: "Проект удалён",
        body: "Этот проект удалён.",
      });
    default:
      return assertNever(error.details.reason);
  }
}

function describeParentThreadInvalid({
  error,
  operation,
}: ParentThreadInvalidDescriptionArgs): LifecycleErrorDescription {
  const isSenderThread = error.details.subject === "sender";
  const title = isSenderThread
    ? "Чат отправителя недоступен"
    : "Родительский чат недоступен";

  switch (error.details.reason) {
    case "not_found":
      return errorDescription({
        operation,
        title,
        body: isSenderThread
          ? "Чат отправителя больше не существует."
          : "Родительский чат больше не существует.",
      });
    case "archived":
      return warning({
        operation,
        title,
        body: isSenderThread
          ? "Чат отправителя архивирован."
          : "Извлеките родительский чат из архива или выберите другой.",
      });
    case "deleted":
      return errorDescription({
        operation,
        title,
        body: isSenderThread
          ? "Чат отправителя удалён."
          : "Родительский чат удалён.",
      });
    case "self":
      return errorDescription({
        operation,
        title,
        body: "Чат не может быть собственным родителем.",
      });
    case "cycle":
      return errorDescription({
        operation,
        title,
        body: "Выберите чат, который не является дочерним для этого чата.",
      });
    case "too_deep":
      return errorDescription({
        operation,
        title,
        body: "Вложенность чатов ограничена четырьмя уровнями.",
      });
    default:
      return assertNever(error.details.reason);
  }
}

function describeDispatchRejected({
  error,
  operation,
}: DispatchRejectedDescriptionArgs): LifecycleErrorDescription {
  return warning({
    operation,
    title: "Заблокировано плагином",
    body: `Заблокировано плагином «${error.details.pluginId}»: ${error.message}`,
  });
}

function describeDispatchHookFailed({
  error,
  operation,
}: DispatchHookFailedDescriptionArgs): LifecycleErrorDescription {
  const reason = error.message.trim();
  const sentence = reason.endsWith(".") ? reason : `${reason}.`;
  return errorDescription({
    operation,
    title: "Ошибка обработчика плагина",
    body: `${sentence} Отключите этот плагин, чтобы продолжить.`,
  });
}

function parseLifecycleError(error: unknown): LifecycleApiError | null {
  if (!(error instanceof HttpError) && !(error instanceof BbHttpError)) {
    return null;
  }

  const result = lifecycleApiErrorSchema.safeParse(error.body);
  return result.success ? result.data : null;
}

export function isHostDisconnectedError(error: unknown): boolean {
  const lifecycleError = parseLifecycleError(error);
  return (
    lifecycleError?.code === "host_unavailable" &&
    lifecycleError.details.reason === "disconnected"
  );
}

export function formatLifecycleErrorDescription(
  description: LifecycleErrorDescription,
): string {
  return `${description.title}. ${description.body}`;
}

export function describeLifecycleError({
  error,
  operation,
}: DescribeLifecycleErrorOptions): LifecycleErrorDescription | null {
  const lifecycleError = parseLifecycleError(error);
  if (!lifecycleError) {
    return null;
  }

  switch (lifecycleError.code) {
    case "environment_not_ready":
      return describeEnvironmentNotReady({
        error: lifecycleError,
        operation,
      });
    case "thread_environment_unavailable":
      return describeThreadEnvironmentUnavailable({
        error: lifecycleError,
        operation,
      });
    case "thread_not_writable":
      return describeThreadNotWritable({ error: lifecycleError, operation });
    case "host_unavailable":
      return describeHostUnavailable({ error: lifecycleError, operation });
    case "project_unavailable":
      return describeProjectUnavailable({
        error: lifecycleError,
        operation,
      });
    case "parent_thread_invalid":
      return describeParentThreadInvalid({
        error: lifecycleError,
        operation,
      });
    case "dispatch_rejected":
      return describeDispatchRejected({ error: lifecycleError, operation });
    case "dispatch_hook_failed":
      return describeDispatchHookFailed({ error: lifecycleError, operation });
    default:
      return assertNever(lifecycleError);
  }
}
