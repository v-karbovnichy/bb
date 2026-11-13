import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { AiServiceSelection, AiTask, AiTextTask } from "@bb/domain";
import type {
  SetAiServiceSelectionRequest,
  SystemAiService,
  SystemAiServicesResponse,
  TestAiServiceResponse,
} from "@bb/server-contract";
import { Button } from "@bb/shared-ui/button";
import { SettingsSection } from "@/components/ui/settings-section";
import { appToast } from "@/components/ui/app-toast";
import { useSystemAiServices } from "@/hooks/queries/system-queries";
import { writeCachedAiServices } from "@/hooks/cache-owners/system-config-cache-owner";
import { sdk } from "@/lib/sdk";
import {
  ChoiceDropdownSetting,
  type ChoiceDropdownOption,
} from "./ChoiceDropdownSetting";

type AiTaskTestResult = TestAiServiceResponse | { ok: false; message: string };

const AUTOMATIC_KEY = "automatic";
const OFF_KEY = "off";

interface AiTaskRow {
  task: AiTask;
  label: string;
  hint: string;
  offDescription: string;
  testTask: AiTextTask | null;
}

const AI_TASK_ROWS: readonly AiTaskRow[] = [
  {
    task: "thread-title",
    label: "Названия чатов",
    hint: "Названия веток формируются по названию чата.",
    offDescription: "Название берётся из начала запроса.",
    testTask: "thread-title",
  },
  {
    task: "commit-message",
    label: "Сообщения коммитов",
    hint: "Создаются при использовании действия «Коммит».",
    offDescription: "Сообщение коммита: «bb: automated commit».",
    testTask: "commit-message",
  },
  {
    task: "voice",
    label: "Голосовой ввод",
    hint: "Расшифровывает речь с микрофона в поле ввода.",
    offDescription: "Скрывает микрофон.",
    testTask: null,
  },
];

function serviceKey(service: Pick<SystemAiService, "id" | "pluginId">): string {
  return `service:${service.pluginId}:${service.id}`;
}

function selectionKey(selection: AiServiceSelection): string {
  return selection.mode === "service"
    ? serviceKey({ id: selection.serviceId, pluginId: selection.pluginId })
    : selection.mode;
}

export function automaticServiceFor(
  view: SystemAiServicesResponse,
  task: AiTask,
): SystemAiService | null {
  return (
    view.services
      .filter(
        (service) =>
          service.automaticRank !== null &&
          service.tasks.includes(task) &&
          service.status.ready,
      )
      .sort((a, b) => (a.automaticRank ?? 0) - (b.automaticRank ?? 0))[0] ??
    null
  );
}

function serviceDescription(service: SystemAiService): string {
  return service.status.ready
    ? `Из плагина ${service.pluginId}.`
    : service.status.message;
}

export function aiTaskOptions(
  view: SystemAiServicesResponse,
  row: AiTaskRow,
): ChoiceDropdownOption[] {
  const automatic = automaticServiceFor(view, row.task);
  return [
    {
      key: AUTOMATIC_KEY,
      title: "Автоматически",
      description:
        automatic === null
          ? "Сейчас ни один встроенный сервис bb не доступен."
          : `Сейчас используется ${automatic.displayName}.`,
    },
    ...view.services
      .filter((service) => service.tasks.includes(row.task))
      .map((service) => ({
        key: serviceKey(service),
        title: service.displayName,
        description: serviceDescription(service),
      })),
    { key: OFF_KEY, title: "Выключено", description: row.offDescription },
  ];
}

function selectionFromKey(
  view: SystemAiServicesResponse,
  key: string,
): AiServiceSelection | null {
  if (key === AUTOMATIC_KEY) return { mode: "automatic" };
  if (key === OFF_KEY) return { mode: "off" };
  const service = view.services.find(
    (candidate) => serviceKey(candidate) === key,
  );
  return service === undefined
    ? null
    : { mode: "service", pluginId: service.pluginId, serviceId: service.id };
}

function rowDescription(
  view: SystemAiServicesResponse,
  row: AiTaskRow,
  testResult: AiTaskTestResult | undefined,
): string {
  const selection = view.selections[row.task];
  let current = "";
  if (selection.mode === "automatic") {
    const automatic = automaticServiceFor(view, row.task);
    current =
      automatic === null
        ? " Nothing is ready, so bb falls back."
        : ` Using ${automatic.displayName}.`;
  } else if (selection.mode === "service") {
    const service = view.services.find(
      (candidate) =>
        candidate.id === selection.serviceId &&
        candidate.pluginId === selection.pluginId,
    );
    current =
      service === undefined
        ? ` The ${selection.pluginId} plugin is not loaded.`
        : service.status.ready
          ? ""
          : ` ${service.status.message}`;
  }
  const test =
    testResult === undefined
      ? ""
      : testResult.ok
        ? ` Test: “${testResult.text}” from ${testResult.displayName} in ${testResult.durationMs} ms.`
        : ` Test failed: ${testResult.message}`;
  return `${row.hint}${current}${test}`;
}

export function AiServicesSettingsSection() {
  const queryClient = useQueryClient();
  const aiServicesQuery = useSystemAiServices();
  const [testResults, setTestResults] = useState<
    Partial<Record<AiTextTask, AiTaskTestResult>>
  >({});
  const select = useMutation({
    meta: { showErrorToast: false },
    mutationFn: (request: SetAiServiceSelectionRequest) =>
      sdk.system.setAiServiceSelection(request),
    onSuccess: (view) => {
      writeCachedAiServices(queryClient, view);
    },
    onError: (error) => {
      appToast.error("Не удалось изменить сервис ИИ", {
        description: error instanceof Error ? error.message : undefined,
      });
    },
  });
  const test = useMutation({
    meta: { showErrorToast: false },
    mutationFn: (task: AiTextTask) => sdk.system.testAiService({ task }),
    onSuccess: (result, task) => {
      setTestResults((current) => ({ ...current, [task]: result }));
    },
    onError: (error, task) => {
      const message =
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : "Не удалось выполнить запрос";
      setTestResults((current) => ({
        ...current,
        [task]: { ok: false, message },
      }));
    },
  });

  const view = aiServicesQuery.data;
  return (
    <SettingsSection
      title="AI services"
      description="Выберите сервисы для названий чатов, сообщений коммитов и голосового ввода. Автоматический выбор предпочитает облако bb, затем другие доступные сервисы. Выбранный вручную сервис останется активным."
    >
      <div className="space-y-5">
        {AI_TASK_ROWS.map((row) => {
          if (view === undefined) {
            return (
              <ChoiceDropdownSetting
                key={row.task}
                label={row.label}
                description={row.hint}
                triggerAriaLabel={row.label}
                options={[]}
                selected={{ key: AUTOMATIC_KEY, title: "Загрузка" }}
                onSelect={() => undefined}
                disabled
              />
            );
          }
          const options = aiTaskOptions(view, row);
          const key = selectionKey(view.selections[row.task]);
          const selected = options.find((option) => option.key === key) ?? {
            key,
            title: "Недоступный плагин",
          };
          const testTask = row.testTask;
          return (
            <ChoiceDropdownSetting
              key={row.task}
              label={row.label}
              description={rowDescription(
                view,
                row,
                testTask === null ? undefined : testResults[testTask],
              )}
              triggerAriaLabel={row.label}
              options={options}
              selected={selected}
              disabled={select.isPending}
              onSelect={(nextKey) => {
                const selection = selectionFromKey(view, nextKey);
                if (selection === null) return;
                setTestResults((current) => {
                  if (testTask === null) return current;
                  const { [testTask]: _cleared, ...rest } = current;
                  return rest;
                });
                select.mutate({ task: row.task, selection });
              }}
            >
              {testTask === null ? null : (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Проверить ${row.label.toLowerCase()}`}
                  disabled={test.isPending}
                  onClick={() => test.mutate(testTask)}
                >
                  {test.isPending && test.variables === testTask
                    ? "Проверка…"
                    : "Проверить"}
                </Button>
              )}
            </ChoiceDropdownSetting>
          );
        })}
      </div>
    </SettingsSection>
  );
}
