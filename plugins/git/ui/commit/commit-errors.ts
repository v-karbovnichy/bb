import { lifecycleApiErrorSchema } from "@bb/server-contract";

export const COMMIT_FAILED_TITLE = "Не удалось создать коммит";
const FALLBACK_MESSAGE = "Не удалось запустить действие Git";
const NETWORK_TRANSPORT_ERROR_MESSAGE =
  "Не удалось связаться с сервером. Проверьте, что он запущен, и повторите попытку.";
const HTTP_STATUS_PREFIX_PATTERN = /^HTTP \d{3}:\s*/u;

function normalize(message: string): string | null {
  const normalized = message.replace(/\s+/g, " ").trim();
  return normalized.length === 0 ? null : normalized;
}

function bodyMessage(body: unknown): string | null {
  if (typeof body === "string") return normalize(body);
  if (typeof body !== "object" || body === null) return null;
  for (const key of ["message", "detail"]) {
    const message = bodyMessage(Reflect.get(body, key));
    if (message !== null) return message;
  }
  return null;
}

function lifecycleBody(body: unknown): string | null {
  const parsed = lifecycleApiErrorSchema.safeParse(body);
  if (!parsed.success) return null;
  const error = parsed.data;
  switch (error.code) {
    case "environment_not_ready":
      switch (error.details.environmentStatus) {
        case "creating":
        case "provisioning":
          return "Рабочая копия ещё запускается.";
        case "ready":
          return "Рабочая копия недоступна.";
        case "error":
          return "Не удалось настроить рабочую копию.";
        case "destroyed":
          return "Рабочая копия больше не существует.";
      }
      return null;
    case "host_unavailable":
      switch (error.details.reason) {
        case "suspended":
          return "Хост приостановлен.";
        case "disconnected":
          return "Хост не в сети.";
        case "destroyed":
          return "Хост удалён.";
      }
      return null;
    default:
      return null;
  }
}

function isNetworkTransportError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("failed to fetch") ||
    lower.includes("load failed") ||
    lower.includes("networkerror")
  );
}

export function commitErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return (
      (typeof error === "string" ? normalize(error) : null) ?? FALLBACK_MESSAGE
    );
  }
  if ("body" in error && "status" in error) {
    const lifecycle = lifecycleBody(error.body);
    if (lifecycle !== null) return `${COMMIT_FAILED_TITLE}. ${lifecycle}`;
    return (
      bodyMessage(error.body) ??
      normalize(error.message.replace(HTTP_STATUS_PREFIX_PATTERN, "")) ??
      FALLBACK_MESSAGE
    );
  }
  if (error.name !== "AbortError" && isNetworkTransportError(error.message)) {
    return NETWORK_TRANSPORT_ERROR_MESSAGE;
  }
  return normalize(error.message) ?? FALLBACK_MESSAGE;
}
