import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PluginMarketplace } from "@bb/server-contract";
import { Badge } from "@bb/shared-ui/badge";
import { Button } from "@bb/shared-ui/button";
import { Input } from "@bb/shared-ui/input";
import { SettingsSection } from "@/components/ui/settings-section";
import { appToast } from "@/components/ui/app-toast";
import {
  ConfirmDeleteDialog,
  ConfirmDeleteDialogContent,
} from "@bb/shared-ui/confirm-delete-dialog";
import { pluginAdminErrorMessage } from "@/lib/plugin-admin-error";
import { invalidatePluginMarketplaces } from "@/hooks/cache-owners/plugin-cache-owner";
import {
  addPluginMarketplace,
  refreshPluginMarketplaces,
  removePluginMarketplace,
  usePluginMarketplaces,
} from "@/hooks/queries/plugin-catalog-queries";

const SOURCE_PLACEHOLDER = "https://example.com/marketplace.json";
const SUBDIRECTORY_PLACEHOLDER = "Подкаталог (необязательно)";

function formatRefreshedAt(marketplace: PluginMarketplace): string {
  if (marketplace.lastError !== null) {
    return `Не удалось выполнить последнее обновление: ${marketplace.lastError}`;
  }
  if (marketplace.lastRefreshAt === null) return "Никогда не обновлялся";
  return `Обновлён ${new Date(marketplace.lastRefreshAt).toLocaleString()}`;
}

export function MarketplacesSettingsSection() {
  const queryClient = useQueryClient();
  const [source, setSource] = useState("");
  const [subdirectory, setSubdirectory] = useState("");
  const isGitSource = source.trimStart().startsWith("git:");
  const [removing, setRemoving] = useState<PluginMarketplace | null>(null);
  const marketplacesQuery = usePluginMarketplaces({ enabled: true });
  const marketplaces = marketplacesQuery.data ?? [];

  const invalidate = () => invalidatePluginMarketplaces({ queryClient });

  const add = useMutation({
    meta: { showErrorToast: false },
    mutationFn: (value: { source: string; subdirectory: string | null }) =>
      addPluginMarketplace(fetch, value),
    onSuccess: (marketplace) => {
      setSource("");
      setSubdirectory("");
      invalidate();
      appToast.success(`Добавлен маркетплейс ${marketplace.displayName}`, {
        description: `В каталоге ${marketplace.entryCount} плагинов. Добавление маркетплейса ничего не устанавливает.`,
      });
    },
    onError: (error) => {
      appToast.error("Не удалось добавить маркетплейс", {
        description: pluginAdminErrorMessage(error),
      });
    },
  });

  const refresh = useMutation({
    meta: { showErrorToast: false },
    mutationFn: (name: string) => refreshPluginMarketplaces(fetch, name),
    onSuccess: (results) => {
      invalidate();
      const failed = results.filter((result) => !result.ok);
      if (failed.length === 0) {
        appToast.success("Маркетплейс обновлён");
        return;
      }
      appToast.error("Не удалось обновить маркетплейс", {
        description: `${failed[0]?.error ?? "Неизвестная ошибка"}. Продолжает использоваться последний проверенный каталог bb.`,
      });
    },
    onError: (error) => {
      appToast.error("Не удалось обновить маркетплейс", {
        description: pluginAdminErrorMessage(error),
      });
    },
  });

  const remove = useMutation({
    meta: { showErrorToast: false },
    mutationFn: (name: string) => removePluginMarketplace(fetch, name),
    onSuccess: (result) => {
      setRemoving(null);
      invalidate();
      appToast.success("Маркетплейс удалён", {
        description:
          result.convertedPluginIds.length === 0
            ? undefined
            : `Сохранены как прямые установки: ${result.convertedPluginIds.join(", ")}`,
      });
    },
    onError: (error) => {
      appToast.error("Не удалось удалить маркетплейс", {
        description: pluginAdminErrorMessage(error),
      });
    },
  });

  return (
    <SettingsSection
      title="Маркетплейсы плагинов"
      description="bb читает каталоги плагинов из этих маркетплейсов. При добавлении каталог проверяется и сохраняется, но код плагинов не устанавливается, не обновляется и не запускается."
      bodyClassName="border-0 bg-transparent p-0"
    >
      <div className="space-y-1.5">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1 space-y-1.5">
            <Input
              value={source}
              aria-label="Источник маркетплейса"
              placeholder={SOURCE_PLACEHOLDER}
              className="h-8 font-mono text-xs"
              onChange={(event) => setSource(event.target.value)}
            />
            {isGitSource ? (
              <Input
                value={subdirectory}
                aria-label="Подкаталог маркетплейса"
                placeholder={SUBDIRECTORY_PLACEHOLDER}
                className="h-8 font-mono text-xs"
                onChange={(event) => setSubdirectory(event.target.value)}
              />
            ) : null}
          </div>
          <Button
            type="button"
            size="sm"
            disabled={source.trim().length === 0 || add.isPending}
            onClick={() =>
              add.mutate({
                source: source.trim(),
                subdirectory:
                  isGitSource && subdirectory.trim().length > 0
                    ? subdirectory.trim()
                    : null,
              })
            }
          >
            {add.isPending ? "Добавление…" : "Добавить"}
          </Button>
        </div>
        <p className="text-2xs text-subtle-foreground">
          HTTPS-адрес манифеста, <code>git:&lt;url&gt;[@&lt;ref&gt;]</code> или{" "}
          <code>path:&lt;directory&gt;</code> на машине сервера bb.
          {isGitSource
            ? " Set a subdirectory when the repository keeps marketplace.json outside its root."
            : null}
        </p>
      </div>

      <ul className="space-y-2 pt-3">
        {marketplaces.map((marketplace) => (
          <li
            key={marketplace.name}
            className="flex items-start gap-3 rounded-md border border-border p-3"
          >
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center gap-2 text-sm text-foreground">
                {marketplace.displayName}
                <span className="font-mono text-2xs text-subtle-foreground">
                  {marketplace.name}
                </span>
                {marketplace.official ? (
                  <Badge variant="outline" className="text-2xs font-normal">
                    Официальный
                  </Badge>
                ) : null}
              </div>
              <p className="truncate font-mono text-2xs text-subtle-foreground">
                {marketplace.source}
                {marketplace.subdirectory === null
                  ? null
                  : ` · подкаталог ${marketplace.subdirectory}`}
              </p>
              <p className="text-2xs text-subtle-foreground">
                Плагинов: {marketplace.entryCount} ·{" "}
                {formatRefreshedAt(marketplace)}
              </p>
            </div>
            <div className="flex shrink-0 gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={refresh.isPending}
                aria-label={`Обновить ${marketplace.displayName}`}
                onClick={() => refresh.mutate(marketplace.name)}
              >
                Обновить
              </Button>
              {marketplace.official ? null : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={`Удалить ${marketplace.displayName}`}
                  onClick={() => setRemoving(marketplace)}
                >
                  Удалить
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>

      <ConfirmDeleteDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) setRemoving(null);
        }}
      >
        <ConfirmDeleteDialogContent
          title={`Удалить ${removing?.displayName ?? "маркетплейс"}?`}
          description="Его каталог и сохранённые значки будут удалены. Установленные из него плагины продолжат работать как прямые установки и проверять обновления из своего источника."
          confirmLabel={remove.isPending ? "Удаление…" : "Удалить"}
          pending={remove.isPending}
          onConfirm={() => {
            if (removing !== null) remove.mutate(removing.name);
          }}
          onCancel={() => setRemoving(null)}
        />
      </ConfirmDeleteDialog>
    </SettingsSection>
  );
}
