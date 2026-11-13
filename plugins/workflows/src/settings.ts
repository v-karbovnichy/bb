import type {
  BbPluginApi,
  PluginSettingDescriptors,
  PluginSettingsValues,
} from "@get-bb/plugin-sdk";
import { z } from "zod";

interface IntegerField {
  label: string;
  minimum: number;
  maximum: number;
}

const INTEGER_FIELDS = Object.freeze({
  maxActiveRuns: {
    label: "Максимум активных запусков",
    minimum: 1,
    maximum: 32,
  },
  maxConcurrentAgents: {
    label: "Параллельные агенты на запуск",
    minimum: 1,
    maximum: 64,
  },
  maxAgentCalls: {
    label: "Максимум вызовов агентов",
    minimum: 1,
    maximum: 1_000,
  },
  totalRunTimeoutMs: {
    label: "Общее время ожидания запуска",
    minimum: 60_000,
    maximum: 604_800_000,
  },
  retentionDays: {
    label: "Срок хранения в днях",
    minimum: 1,
    maximum: 3_650,
  },
  maxNotificationBytes: {
    label: "Максимальный размер уведомления в байтах",
    minimum: 1_024,
    maximum: 262_144,
  },
});

function boundedIntegerSchema(field: IntegerField) {
  const rangeMessage = `${field.label}: значение должно быть от ${field.minimum} до ${field.maximum}`;
  return z
    .number()
    .int(`${field.label}: требуется целое число`)
    .min(field.minimum, rangeMessage)
    .max(field.maximum, rangeMessage);
}

const workflowSettingsSchema = z.object({
  maxActiveRuns: boundedIntegerSchema(INTEGER_FIELDS.maxActiveRuns),
  maxConcurrentAgents: boundedIntegerSchema(INTEGER_FIELDS.maxConcurrentAgents),
  maxAgentCalls: boundedIntegerSchema(INTEGER_FIELDS.maxAgentCalls),
  totalRunTimeoutMs: boundedIntegerSchema(INTEGER_FIELDS.totalRunTimeoutMs),
  retentionDays: boundedIntegerSchema(INTEGER_FIELDS.retentionDays),
  maxNotificationBytes: boundedIntegerSchema(
    INTEGER_FIELDS.maxNotificationBytes,
  ),
});

export type WorkflowSettings = z.infer<typeof workflowSettingsSchema>;

export const WORKFLOW_SETTING_DESCRIPTORS = {
  maxActiveRuns: {
    type: "number",
    label: "Максимум активных запусков",
    description: "Одновременные запуски рабочих процессов во всём плагине (1–32).",
    experimental_schema: workflowSettingsSchema.shape.maxActiveRuns,
    default: 4,
  },
  maxConcurrentAgents: {
    type: "number",
    label: "Параллельные агенты на запуск",
    description: "Одновременные вызовы агентов в одном рабочем процессе (1–64).",
    experimental_schema: workflowSettingsSchema.shape.maxConcurrentAgents,
    default: 8,
  },
  maxAgentCalls: {
    type: "number",
    label: "Максимум вызовов агентов",
    description: "Допустимое число вызовов агентов за один запуск (1–1000).",
    experimental_schema: workflowSettingsSchema.shape.maxAgentCalls,
    default: 100,
  },
  totalRunTimeoutMs: {
    type: "number",
    label: "Общее время ожидания запуска (мс)",
    description:
      "Завершать рабочий процесс с ошибкой по истечении этого времени в миллисекундах (60000–604800000).",
    experimental_schema: workflowSettingsSchema.shape.totalRunTimeoutMs,
    default: 86_400_000,
  },
  retentionDays: {
    type: "number",
    label: "Срок хранения (дни)",
    description: "Сколько дней хранить данные завершённых рабочих процессов (1–3650).",
    experimental_schema: workflowSettingsSchema.shape.retentionDays,
    default: 7,
  },
  maxNotificationBytes: {
    type: "number",
    label: "Максимальный размер уведомления в байтах",
    description:
      "Максимальный размер уведомления о завершении в UTF-8 (1024–262144 байт).",
    experimental_schema: workflowSettingsSchema.shape.maxNotificationBytes,
    default: 16_384,
  },
} as const satisfies PluginSettingDescriptors;

type DeclaredWorkflowSettings = PluginSettingsValues<
  typeof WORKFLOW_SETTING_DESCRIPTORS
>;

export const DEFAULT_WORKFLOW_SETTINGS: Readonly<WorkflowSettings> =
  Object.freeze({
    maxActiveRuns: 4,
    maxConcurrentAgents: 8,
    maxAgentCalls: 100,
    totalRunTimeoutMs: 24 * 60 * 60 * 1_000,
    retentionDays: 7,
    maxNotificationBytes: 16 * 1_024,
  });

export function validateWorkflowSettings(
  values: Readonly<DeclaredWorkflowSettings>,
): WorkflowSettings {
  return Object.freeze(workflowSettingsSchema.parse(values));
}

const LEGACY_STORED_SETTING_KEYS = new Set(["workerStallTimeoutMs"]);

export function parseStoredWorkflowSettings(value: unknown): WorkflowSettings {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Снимок настроек рабочего процесса должен быть объектом");
  }
  const object = value as Record<string, unknown>;
  const expected = Object.keys(INTEGER_FIELDS);
  const actual = Object.keys(object);
  if (
    expected.some((key) => !Object.hasOwn(object, key)) ||
    actual.some(
      (key) =>
        !Object.hasOwn(INTEGER_FIELDS, key) &&
        !LEGACY_STORED_SETTING_KEYS.has(key),
    )
  ) {
    throw new Error("В снимке настроек рабочего процесса есть неожиданные поля");
  }
  const stored = Object.fromEntries(
    expected.map((key) => {
      const value = object[key];
      if (typeof value !== "number" || !Number.isSafeInteger(value)) {
        throw new Error(`Поле ${key} в снимке настроек рабочего процесса должно быть целым числом`);
      }
      return [key, value];
    }),
  ) as WorkflowSettings;
  return validateWorkflowSettings(stored);
}

interface WorkflowSettingsHandle {
  get(): Promise<WorkflowSettings>;
  onChange(
    listener: (next: WorkflowSettings, previous: WorkflowSettings) => void,
    onInvalid?: (error: Error) => void,
  ): void;
}

export function registerWorkflowSettings(
  bb: Pick<BbPluginApi, "settings">,
): WorkflowSettingsHandle {
  const handle = bb.settings.define(WORKFLOW_SETTING_DESCRIPTORS);
  let lastValid = DEFAULT_WORKFLOW_SETTINGS;
  return {
    async get() {
      const validated = validateWorkflowSettings(await handle.get());
      lastValid = validated;
      return validated;
    },
    onChange(listener, onInvalid) {
      handle.onChange((next, previous) => {
        try {
          const validatedNext = validateWorkflowSettings(next);
          let parsedPrevious = lastValid;
          try {
            parsedPrevious = validateWorkflowSettings(previous);
          } catch {}
          lastValid = validatedNext;
          listener(validatedNext, parsedPrevious);
        } catch (error) {
          onInvalid?.(
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      });
    },
  };
}
