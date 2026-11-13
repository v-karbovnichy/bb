export const SETTING_DESCRIPTORS = {
  tokenId: {
    type: "string",
    secret: true,
    label: "ID токена Modal",
    description:
      "Часть ID токена API Modal (команда modal token new записывает токен в ~/.modal.toml).",
  },
  tokenSecret: {
    type: "string",
    label: "Секрет токена Modal",
    secret: true,
    description: "Секретная часть того же токена API Modal.",
  },
  appName: {
    type: "string",
    label: "Имя приложения Modal",
    description: "Приложение Modal, в котором создаются песочницы.",
    default: "bb-sandboxes",
  },
  idleMinutes: {
    type: "number",
    label: "Останавливать после простоя (минуты)",
    description:
      "Сохранять снимок и останавливать песочницу после указанного простоя. Значение 0 оставляет её работающей до 24-часового лимита Modal.",
    default: 15,
  },
} as const;

export interface ResolvedSettings {
  tokenId: string;
  tokenSecret: string;
  appName: string;
  idleMs: number | null;
}

export type SettingsResolution =
  | { ok: true; settings: ResolvedSettings }
  | { ok: false; message: string };

export interface RawSettings {
  tokenId: string | undefined;
  tokenSecret: string | undefined;
  appName: string;
  idleMinutes: number;
}

export const SANDBOX_LIFETIME_MS = 24 * 60 * 60_000;
export const DEFAULT_SANDBOX_SIZE = { cpu: 1, memoryMiB: 2048 } as const;
const MAX_IDLE_MINUTES = 24 * 60;

export function resolveSettings(raw: RawSettings): SettingsResolution {
  const tokenId = (raw.tokenId ?? "").trim();
  const tokenSecret = (raw.tokenSecret ?? "").trim();
  const missing: string[] = [];
  if (tokenId.length === 0) missing.push("tokenId");
  if (tokenSecret.length === 0) missing.push("tokenSecret");
  if (missing.length > 0) {
    return {
      ok: false,
      message: `Укажите ${missing.join(" и ")} в настройках плагина.`,
    };
  }
  const appName = raw.appName.trim();
  if (appName.length === 0) {
    return { ok: false, message: "Имя приложения не может быть пустым." };
  }
  if (
    !Number.isInteger(raw.idleMinutes) ||
    raw.idleMinutes < 0 ||
    raw.idleMinutes > MAX_IDLE_MINUTES
  ) {
    return {
      ok: false,
      message: `idleMinutes должен быть целым числом от 0 до ${MAX_IDLE_MINUTES}, получено: ${raw.idleMinutes}.`,
    };
  }
  return {
    ok: true,
    settings: {
      tokenId,
      tokenSecret,
      appName,
      idleMs: raw.idleMinutes === 0 ? null : raw.idleMinutes * 60_000,
    },
  };
}
