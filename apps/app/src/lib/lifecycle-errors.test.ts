import { describe, expect, it } from "vitest";
import type { LifecycleApiError } from "@bb/server-contract";
import { HttpError } from "./api";
import {
  describeLifecycleError,
  formatLifecycleErrorDescription,
  type LifecycleErrorDescription,
} from "./lifecycle-errors";

type Details<Code extends LifecycleApiError["code"]> = Extract<
  LifecycleApiError,
  { code: Code }
>["details"];

type Expected = [
  severity: LifecycleErrorDescription["severity"],
  title: string,
  body: string,
];

function httpError(body: LifecycleApiError): HttpError {
  return new HttpError({
    body,
    code: body.code,
    message: body.message,
    status: 409,
  });
}

function environmentNotReady(
  environmentStatus: Details<"environment_not_ready">["environmentStatus"],
): LifecycleApiError {
  return {
    code: "environment_not_ready",
    message: "Environment unavailable",
    details: { environmentStatus, hasPath: false },
  };
}

function threadEnvironmentUnavailable(
  reason: Details<"thread_environment_unavailable">["reason"],
  environmentStatus: Details<"thread_environment_unavailable">["environmentStatus"],
): LifecycleApiError {
  return {
    code: "thread_environment_unavailable",
    message: "Thread environment is unavailable",
    details: { environmentStatus, reason },
  };
}

function threadNotWritable(
  reason: Details<"thread_not_writable">["reason"],
  threadStatus: Details<"thread_not_writable">["threadStatus"],
  archivedAt: number | null = null,
): LifecycleApiError {
  return {
    code: "thread_not_writable",
    message: "Thread is not writable",
    details: { archivedAt, reason, threadStatus },
  };
}

function hostUnavailable(
  details: Details<"host_unavailable">,
): LifecycleApiError {
  return { code: "host_unavailable", message: "Host unavailable", details };
}

function projectUnavailable(
  reason: Details<"project_unavailable">["reason"],
  deletedAt: number | null,
): LifecycleApiError {
  return {
    code: "project_unavailable",
    message: "Project unavailable",
    details: { deletedAt, reason },
  };
}

function parentThreadInvalid(
  reason: Details<"parent_thread_invalid">["reason"],
  subject: Details<"parent_thread_invalid">["subject"] = "parent",
): LifecycleApiError {
  return {
    code: "parent_thread_invalid",
    message: "Parent thread is invalid",
    details: { reason, subject },
  };
}

const descriptionCases: Array<[string, LifecycleApiError, Expected]> = [
  [
    "environment_not_ready provisioning",
    environmentNotReady("provisioning"),
    ["info", "Рабочее пространство запускается", "Рабочее пространство ещё запускается."],
  ],
  [
    "environment_not_ready ready",
    environmentNotReady("ready"),
    ["warning", "Рабочее пространство недоступно", "Рабочее пространство недоступно."],
  ],
  [
    "environment_not_ready error",
    environmentNotReady("error"),
    ["error", "Не удалось настроить рабочее пространство", "Не удалось настроить рабочее пространство."],
  ],
  [
    "environment_not_ready destroyed archived thread",
    environmentNotReady("destroyed"),
    ["warning", "Рабочее пространство недоступно", "Рабочее пространство больше не существует."],
  ],
  [
    "thread_environment_unavailable never attached",
    threadEnvironmentUnavailable("never_attached", null),
    ["info", "Рабочее пространство недоступно", "Рабочее пространство пока недоступно."],
  ],
  [
    "thread_environment_unavailable destroyed",
    threadEnvironmentUnavailable("destroyed", "destroyed"),
    ["warning", "Рабочее пространство недоступно", "Рабочее пространство больше не существует."],
  ],
  [
    "thread_environment_unavailable provisioning",
    threadEnvironmentUnavailable("provisioning", "provisioning"),
    ["info", "Рабочее пространство запускается", "Рабочее пространство ещё запускается."],
  ],
  [
    "thread_environment_unavailable errored",
    threadEnvironmentUnavailable("errored", "error"),
    ["error", "Не удалось настроить рабочее пространство", "Не удалось настроить рабочее пространство."],
  ],
  [
    "thread_not_writable archived",
    threadNotWritable("archived", "idle", 10),
    ["info", "Чат архивирован", "Сначала извлеките чат из архива."],
  ],
  [
    "thread_not_writable stopping",
    threadNotWritable("stopping", "stopping"),
    ["warning", "Чат останавливается", "Чат останавливается."],
  ],
  [
    "thread_not_writable deleted",
    threadNotWritable("deleted", "idle"),
    ["error", "Чат удалён", "Этот чат удалён."],
  ],
  [
    "thread_not_writable not started while starting",
    threadNotWritable("not_started", "starting"),
    ["info", "Чат запускается", "Чат ещё запускается."],
  ],
  [
    "thread_not_writable not active",
    threadNotWritable("not_active", "idle"),
    ["warning", "Чат не запущен", "Чат не запущен."],
  ],
  [
    "thread_not_writable errored",
    threadNotWritable("errored", "error"),
    ["error", "Ошибка чата", "В этом чате произошла ошибка; продолжить его нельзя."],
  ],
  [
    "thread_not_writable already active",
    threadNotWritable("already_active", "active"),
    ["warning", "Чат уже работает", "Чат уже работает."],
  ],
  [
    "thread_not_writable still starting",
    threadNotWritable("still_starting", "starting"),
    ["info", "Чат запускается", "Чат ещё запускается."],
  ],
  [
    "host_unavailable suspended",
    hostUnavailable({
      destroyedAt: null,
      hostStatus: "disconnected",
      reason: "suspended",
      suspendedAt: 10,
    }),
    ["warning", "Компьютер приостановлен", "Компьютер приостановлен."],
  ],
  [
    "host_unavailable disconnected",
    hostUnavailable({
      destroyedAt: null,
      hostStatus: "disconnected",
      reason: "disconnected",
      suspendedAt: null,
    }),
    ["warning", "Компьютер не в сети", "Компьютер не в сети."],
  ],
  [
    "host_unavailable destroyed",
    hostUnavailable({
      destroyedAt: 10,
      hostStatus: null,
      reason: "destroyed",
      suspendedAt: null,
    }),
    ["error", "Компьютер удалён", "Компьютер удалён."],
  ],
  [
    "project_unavailable pending deletion",
    projectUnavailable("pending_deletion", null),
    ["info", "Проект удаляется", "Этот проект удаляется."],
  ],
  [
    "project_unavailable deleted",
    projectUnavailable("deleted", 10),
    ["error", "Проект удалён", "Этот проект удалён."],
  ],
  [
    "parent_thread_invalid not found",
    parentThreadInvalid("not_found"),
    [
      "error",
      "Родительский чат недоступен",
      "Родительский чат больше не существует.",
    ],
  ],
  [
    "parent_thread_invalid archived",
    parentThreadInvalid("archived"),
    [
      "warning",
      "Родительский чат недоступен",
      "Извлеките родительский чат из архива или выберите другой.",
    ],
  ],
  [
    "parent_thread_invalid deleted",
    parentThreadInvalid("deleted"),
    ["error", "Родительский чат недоступен", "Родительский чат удалён."],
  ],
  [
    "parent_thread_invalid self",
    parentThreadInvalid("self"),
    [
      "error",
      "Родительский чат недоступен",
      "Чат не может быть собственным родителем.",
    ],
  ],
  [
    "parent_thread_invalid cycle",
    parentThreadInvalid("cycle"),
    [
      "error",
      "Родительский чат недоступен",
      "Выберите чат, который не является дочерним для этого чата.",
    ],
  ],
  [
    "parent_thread_invalid too deep",
    parentThreadInvalid("too_deep"),
    [
      "error",
      "Родительский чат недоступен",
      "Вложенность чатов ограничена четырьмя уровнями.",
    ],
  ],
  [
    "parent_thread_invalid sender",
    parentThreadInvalid("not_found", "sender"),
    [
      "error",
      "Чат отправителя недоступен",
      "Чат отправителя больше не существует.",
    ],
  ],
  [
    "dispatch_rejected shows the plugin's message verbatim",
    {
      code: "dispatch_rejected",
      message: "Sandbox quota is exhausted. Free a slot first.",
      details: { pluginId: "policy-guard" },
    },
    [
      "warning",
      "Заблокировано плагином",
      'Заблокировано плагином «policy-guard»: Sandbox quota is exhausted. Free a slot first.',
    ],
  ],
  [
    "dispatch_hook_failed adds the recovery hint",
    {
      code: "dispatch_hook_failed",
      message:
        'The "policy-guard" plugin\'s message.dispatch hook failed: did not decide within 5000ms',
      details: { pluginId: "policy-guard" },
    },
    [
      "error",
      "Ошибка обработчика плагина",
      'The "policy-guard" plugin\'s message.dispatch hook failed: did not decide within 5000ms. Отключите этот плагин, чтобы продолжить.',
    ],
  ],
];

describe("describeLifecycleError", () => {
  it.each(descriptionCases)("%s", (_name, body, [severity, title, text]) => {
    expect(describeLifecycleError({ error: httpError(body) })).toEqual({
      title,
      body: text,
      severity,
    });
  });

  it("uses operation titles while keeping lifecycle reason text", () => {
    expect(
      describeLifecycleError({
        error: httpError(environmentNotReady("destroyed")),
        operation: "load_diff",
      }),
    ).toEqual({
      title: "Не удалось загрузить изменения",
      body: "Рабочее пространство больше не существует.",
      severity: "warning",
    });
  });

  it("formats lifecycle descriptions as a single action-oriented message", () => {
    expect(
      formatLifecycleErrorDescription({
        title: "Не удалось отправить сообщение",
        body: "Чат ещё запускается.",
        severity: "info",
      }),
    ).toBe("Не удалось отправить сообщение. Чат ещё запускается.");
  });

  it("returns null for non-lifecycle errors", () => {
    const genericError = new HttpError({
      body: {
        code: "invalid_request",
        message: "Request failed",
      },
      code: "invalid_request",
      message: "Request failed",
      status: 400,
    });

    expect(describeLifecycleError({ error: new Error("Failed") })).toBeNull();
    expect(describeLifecycleError({ error: genericError })).toBeNull();
  });

  it("keeps a gate rejection readable under an operation title", () => {
    const pluginMessage = "This project is frozen until the release ships.";
    const body: LifecycleApiError = {
      code: "dispatch_rejected",
      message: pluginMessage,
      details: { pluginId: "release-freeze" },
    };

    const description = describeLifecycleError({
      error: httpError(body),
      operation: "send_message",
    });

    if (!description) {
      throw new Error("expected a lifecycle description");
    }
    expect(description.body).toContain(pluginMessage);
    expect(description.body).toContain('«release-freeze»');
    expect(formatLifecycleErrorDescription(description)).toBe(
      'Не удалось отправить сообщение. Заблокировано плагином «release-freeze»: This project is frozen until the release ships.',
    );
  });
});
