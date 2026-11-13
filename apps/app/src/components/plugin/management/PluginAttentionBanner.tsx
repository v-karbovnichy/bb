import { Button } from "@bb/shared-ui/button";
import { AttentionBanner } from "@/components/ui/attention-banner";
import type { PluginListItem } from "@/hooks/queries/plugin-settings-queries";
import { pluginsNeedingAttention } from "@/hooks/usePluginAttention";
import { pluginRuntimeStatusPresentation } from "./plugin-status";

export function PluginAttentionBanner({
  plugins,
  onOpenPlugin,
}: {
  plugins: readonly PluginListItem[];
  onOpenPlugin: (pluginId: string, trigger: HTMLButtonElement) => void;
}) {
  const affected = pluginsNeedingAttention(plugins);
  if (affected.length === 0) return null;
  return (
    <AttentionBanner
      title={
        affected.length === 1
          ? "Один плагин не запущен"
          : `Не запущено плагинов: ${affected.length}`
      }
    >
      <ul className="space-y-2">
        {affected.map((plugin) => {
          const status = pluginRuntimeStatusPresentation(plugin);
          return (
            <li key={plugin.id} className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{plugin.name ?? plugin.id}</p>
                <p className="line-clamp-2 text-xs text-muted-foreground">
                  {status?.condition}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0"
                onClick={(event) =>
                  onOpenPlugin(plugin.id, event.currentTarget)
                }
                aria-label={`Посмотреть сведения о ${plugin.name ?? plugin.id}`}
              >
                Подробнее
              </Button>
            </li>
          );
        })}
      </ul>
    </AttentionBanner>
  );
}
