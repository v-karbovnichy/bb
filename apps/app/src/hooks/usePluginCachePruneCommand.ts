import { useAppCommandHandler } from "@/components/commands/AppCommandProvider";
import { appToast } from "@/components/ui/app-toast";
import { formatByteSize } from "@bb/shared-ui/lib/format-byte-size";
import { prunePluginCache } from "@/hooks/queries/plugin-settings-queries";

export function usePluginCachePruneCommand(): void {
  useAppCommandHandler("plugins.pruneCache", () => {
    void prunePluginCache(fetch).then(
      (result) => {
        appToast.success(
          result.removed.length === 0
            ? "Plugin cache is already clean"
            : `Freed ${formatByteSize(result.bytes)}`,
          {
            description:
              result.removed.length === 0
                ? "У установленных плагинов нет неиспользуемых версий."
                : `Deleted ${result.removed.length} unused cached plugin version${result.removed.length === 1 ? "" : "s"}.`,
          },
        );
      },
      (error: unknown) => {
        appToast.error("Не удалось очистить кэш плагинов", {
          description: error instanceof Error ? error.message : String(error),
        });
      },
    );
    return true;
  });
}
