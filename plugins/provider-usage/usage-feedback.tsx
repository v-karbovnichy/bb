import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import type { UsageMachine, UsageProvider } from "./usage-schema.js";

export const usageFeedbackMessages = {
  loading: "Загрузка данных об использовании…",
  noSources: "Источники данных об использовании недоступны.",
  loadFailed: "Не удалось загрузить данные об использовании.",
  refreshFailed: "Не удалось обновить данные. Показаны последние сохранённые данные.",
  unavailable: "Данные об использовании недоступны.",
} as const;

export function hasReportedUsage(providers: readonly UsageProvider[]): boolean {
  return providers.some((provider) => provider.usage !== null);
}

export function emptyUsageMessage(machine: UsageMachine): string {
  return machine.id.startsWith("source:")
    ? "Аккаунты пока не передают данные об использовании. Настройте их в параметрах исходного плагина."
    : "Провайдеры не передают данные о лимитах на этой машине.";
}

export function offlineUsageMessage(
  machine: UsageMachine,
  hasUsage: boolean,
): string {
  return hasUsage
    ? `${machine.displayName} не в сети. Показаны последние сохранённые данные.`
    : `${machine.displayName} не в сети. Данные обновятся после подключения.`;
}

export function UsageFeedback({
  message,
  loading = false,
  className,
}: {
  message: string;
  loading?: boolean;
  className?: string;
}) {
  return (
    <div
      role="status"
      className={cn(
        "flex min-w-0 items-start text-xs text-muted-foreground",
        !loading && "gap-2 rounded-md bg-muted/60 px-2.5 py-2",
        className,
      )}
    >
      {loading ? null : (
        <Icon
          name="Info"
          aria-hidden="true"
          className="mt-0.5 size-3.5 shrink-0"
        />
      )}
      <span className="min-w-0 flex-1">{message}</span>
    </div>
  );
}
