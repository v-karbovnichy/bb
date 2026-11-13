import type {
  PluginRangeUpgrade,
  PluginRuntimeStatus,
} from "@bb/server-contract";
import type { IconName } from "@bb/shared-ui/icon";
import type { PluginListItem } from "@/hooks/queries/plugin-settings-queries";

export interface PluginRuntimeStatusPresentation {
  icon: IconName;
  label: string;
  tone: "error" | "warning" | "muted";
  condition: string;
  recovery: string;
}

type PluginRuntimeStatusDefinition = Omit<
  PluginRuntimeStatusPresentation,
  "condition" | "recovery"
>;

const PLUGIN_RUNTIME_STATUS_DEFINITIONS: Record<
  PluginRuntimeStatus,
  PluginRuntimeStatusDefinition | null
> = {
  starting: { icon: "Clock", label: "Запускается", tone: "muted" },
  running: null,
  error: { icon: "CircleX", label: "Ошибка", tone: "error" },
  incompatible: {
    icon: "AlertCircle",
    label: "Несовместим",
    tone: "error",
  },
  missing: { icon: "FileQuestion", label: "Отсутствует", tone: "error" },
  disabled: null,
  "needs-configuration": {
    icon: "Settings",
    label: "Требует настройки",
    tone: "warning",
  },
  degraded: { icon: "AlertTriangle", label: "Работает с ограничениями", tone: "warning" },
};

function configuredPathUnavailable(plugin: PluginListItem): boolean {
  return /\bconfigured\b.*\b(directory|folder|path)\b/iu.test(
    plugin.statusDetail ?? "",
  );
}

function pluginRuntimeRecovery(plugin: PluginListItem): string {
  switch (plugin.status) {
    case "error":
      if (configuredPathUnavailable(plugin))
        return "Проверьте путь и перезагрузите.";
      return plugin.source.startsWith("path:")
        ? "Исправьте плагин и перезагрузите."
        : "Попробуйте перезагрузить.";
    case "incompatible":
      return plugin.provenance === "builtin"
        ? "Обновите bb."
        : "Установите совместимую версию.";
    case "missing":
      if (plugin.source.startsWith("path:"))
        return "Восстановите папку и перезагрузите.";
      return plugin.provenance === "builtin"
        ? "Обновите или переустановите bb."
        : "Переустановите из источника.";
    case "needs-configuration":
      return plugin.hasSettings ? "" : "Затем перезагрузите.";
    case "degraded":
      return "Подождите и перезагрузите.";
    default:
      return "";
  }
}

function pluginRuntimeCondition(plugin: PluginListItem): string {
  switch (plugin.status) {
    case "starting":
      return "Плагин запускается.";
    case "error":
      return configuredPathUnavailable(plugin)
        ? "Настроенная папка недоступна."
        : "Не удалось запустить плагин.";
    case "incompatible":
      return "Эта версия несовместима с bb.";
    case "missing":
      return "Файлы плагина отсутствуют.";
    case "needs-configuration": {
      const detail = plugin.statusDetail?.trim();
      return detail && detail.length <= 60
        ? detail
        : "Завершите обязательную настройку.";
    }
    case "degraded":
      return "Служба ещё останавливается.";
    default:
      return "";
  }
}

export function pluginRuntimeStatusPresentation(
  plugin: PluginListItem,
): PluginRuntimeStatusPresentation | null {
  const definition = PLUGIN_RUNTIME_STATUS_DEFINITIONS[plugin.status];
  if (definition === null) return null;
  return {
    ...definition,
    condition: pluginRuntimeCondition(plugin),
    recovery: pluginRuntimeRecovery(plugin),
  };
}

export type PluginRowSignal =
  | { kind: "update"; version: string }
  | {
      kind: "status";
      icon: IconName;
      label: string;
      tone: PluginRuntimeStatusPresentation["tone"];
      detail: string | null;
    };

export function reviewableRangeUpgrade(
  plugin: PluginListItem,
): PluginRangeUpgrade | null {
  const state = plugin.updateState;
  return state.availableLabel === null &&
    state.rangeUpgrade !== null &&
    state.rangeUpgrade.reasons.length === 0
    ? state.rangeUpgrade
    : null;
}

type PluginRowStatusSignal = Extract<PluginRowSignal, { kind: "status" }>;
type PluginRowUpdateSignal = Extract<PluginRowSignal, { kind: "update" }>;

function pluginRowStatusSignal(
  plugin: PluginListItem,
): PluginRowStatusSignal | null {
  const state = plugin.updateState;
  if (state.lastFailure !== null) {
    return {
      kind: "status",
      icon: "RotateCcw",
      label: "Ошибка обновления",
      tone: "error",
      detail:
        state.lastFailure.detail.length > 0
          ? state.lastFailure.detail
          : `Не удалось обновить до ${state.lastFailure.label}; предыдущая версия восстановлена.`,
    };
  }
  const runtimeStatus = pluginRuntimeStatusPresentation(plugin);
  if (runtimeStatus !== null) {
    return {
      kind: "status",
      icon: runtimeStatus.icon,
      label: runtimeStatus.label,
      tone: runtimeStatus.tone,
      detail: plugin.statusDetail,
    };
  }
  if (state.outcome === "unavailable") {
    return {
      kind: "status",
      icon: "AlertTriangle",
      label: "Требует внимания",
      tone: "warning",
      detail: state.detail,
    };
  }
  return null;
}

export function pluginRowSignals(plugin: PluginListItem): {
  status: PluginRowStatusSignal | null;
  update: PluginRowUpdateSignal | null;
} {
  const status = pluginRowStatusSignal(plugin);
  const state = plugin.updateState;
  if (status === null && state.availableLabel !== null) {
    return {
      status,
      update: { kind: "update", version: state.availableLabel },
    };
  }
  const rangeUpgrade = reviewableRangeUpgrade(plugin);
  if (
    rangeUpgrade !== null &&
    (status === null || state.lastFailure !== null)
  ) {
    return {
      status,
      update: { kind: "update", version: rangeUpgrade.candidate.label },
    };
  }
  return { status, update: null };
}
