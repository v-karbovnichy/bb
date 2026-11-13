import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { UPDATE_ACTION_ICON } from "@bb/domain/update-state";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { usePluginNotificationAction } from "@/components/plugin/PluginNotificationDescription";
import { appToast } from "@/components/ui/app-toast";
import { applyPluginUpdateJob } from "@/hooks/cache-owners/plugin-cache-owner";
import { startPluginUpdate } from "@/hooks/queries/plugin-update-job-queries";
import type { PluginListItem } from "@/hooks/queries/plugin-settings-queries";
import { pluginAdminErrorMessage } from "@/lib/plugin-admin-error";
import { DetailsDisclosure } from "./plugin-ui";
import { reviewableRangeUpgrade } from "./plugin-status";
import { UpdatePluginDialog } from "./UpdatePluginDialog";

export function pluginHasUpdateSurfaces(plugin: PluginListItem): boolean {
  if (plugin.source.startsWith("builtin:") || plugin.source.startsWith("path:"))
    return false;
  return plugin.provenance === "direct" || plugin.provenance === "catalog";
}

function pluginCompatibilityBlockedVersion(
  plugin: PluginListItem,
): string | null {
  if (!pluginHasUpdateSurfaces(plugin)) return null;
  return plugin.updateState.availableLabel === null
    ? plugin.updateState.blockedLabel
    : null;
}

function sentence(value: string): string {
  const trimmed = value.trim();
  const capitalized = `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`;
  return /[.!?]$/u.test(capitalized) ? capitalized : `${capitalized}.`;
}

export function PluginDetailReleaseControl({
  plugin,
}: {
  plugin: PluginListItem;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const queryClient = useQueryClient();
  const notificationAction = usePluginNotificationAction();
  const availableVersion = plugin.updateState.availableLabel;
  const failure = plugin.updateState.lastFailure;
  const retry = useMutation({
    meta: { showErrorToast: false },
    mutationFn: () => startPluginUpdate(plugin.id),
    onSuccess: (job) => {
      applyPluginUpdateJob({ queryClient, job });
    },
    onError: (error) => {
      appToast.error("Не удалось обновить плагин", {
        description: `${plugin.name ?? plugin.id} — ${pluginAdminErrorMessage(error)}`,
        action: notificationAction(plugin.id, "installed"),
      });
    },
  });

  if (!pluginHasUpdateSurfaces(plugin)) return null;
  const rangeUpgrade = reviewableRangeUpgrade(plugin);
  if (availableVersion === null) {
    if (rangeUpgrade === null) return null;
    return (
      <>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-6 px-2 text-xs"
          aria-label={`Проверить обновление ${plugin.name ?? plugin.id} до ${rangeUpgrade.candidate.label}`}
          onClick={() => setDetailsOpen(true)}
        >
          <Icon name={UPDATE_ACTION_ICON} className="size-3.5" aria-hidden />
          Проверить
        </Button>
        <UpdatePluginDialog
          plugin={plugin}
          open={detailsOpen}
          onOpenChange={setDetailsOpen}
        />
      </>
    );
  }

  if (failure !== null) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-6 px-2 text-xs"
        disabled={retry.isPending}
        aria-busy={retry.isPending}
        aria-label={`Повторить обновление до ${availableVersion}`}
        onClick={() => retry.mutate()}
      >
        {retry.isPending ? (
          <Icon name="Spinner" className="size-3.5 animate-spin" aria-hidden />
        ) : (
          <Icon name="RotateCcw" className="size-3.5" aria-hidden />
        )}
        Повторить
      </Button>
    );
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-6 px-2 text-xs"
        aria-label={`Обновить ${plugin.name ?? plugin.id} до ${availableVersion}`}
        onClick={() => setDetailsOpen(true)}
      >
        <Icon name={UPDATE_ACTION_ICON} className="size-3.5" aria-hidden />
        Обновить
      </Button>
      <UpdatePluginDialog
        plugin={plugin}
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
      />
    </>
  );
}

function PluginRangeUpgradeStatus({ plugin }: { plugin: PluginListItem }) {
  const rangeUpgrade = plugin.updateState.rangeUpgrade;
  if (rangeUpgrade === null) return null;
  const outside = `Версия ${rangeUpgrade.candidate.label} доступна за пределами диапазона ${rangeUpgrade.currentRange}, которому следует этот плагин.`;
  const runsHere = rangeUpgrade.reasons.length === 0;
  return (
    <div
      role="status"
      aria-label="Обновление за пределами диапазона версий"
      className="flex min-w-0 items-start gap-2.5"
    >
      <Icon
        name={runsHere ? UPDATE_ACTION_ICON : "AlertTriangle"}
        className={`mt-0.5 size-4 shrink-0 ${runsHere ? "text-muted-foreground" : "text-warning"}`}
        aria-hidden
      />
      <p className="min-w-0 text-xs leading-relaxed text-muted-foreground">
        {outside}{" "}
        {runsHere
          ? [
              rangeUpgrade.basis === "catalog"
                ? `Теперь в каталоге указан диапазон ${rangeUpgrade.range}.`
                : null,
              rangeUpgrade.breaking
                ? "Обновление может содержать несовместимые изменения. bb установит его после вашей проверки."
                : "Проверьте обновление, чтобы изменить диапазон версий и установить его.",
            ]
              .filter((part) => part !== null)
              .join(" ")
          : `${sentence(rangeUpgrade.reasons[0] ?? "она несовместима с этой версией bb")} Версия ${plugin.version} остаётся установленной.`}
      </p>
    </div>
  );
}

export function PluginDetailReleaseStatus({
  plugin,
}: {
  plugin: PluginListItem;
}) {
  const failure = plugin.updateState.lastFailure;
  const blockedVersion = pluginCompatibilityBlockedVersion(plugin);
  const blockedReasons = plugin.updateState.blockedReasons;

  if (!pluginHasUpdateSurfaces(plugin)) return null;

  if (failure !== null) {
    return (
      <div className="flex min-w-0 flex-col gap-2">
        <div
          role="status"
          aria-label="Ошибка обновления"
          className="flex min-w-0 items-start gap-2.5"
        >
          <Icon
            name="CircleX"
            className="mt-0.5 size-4 shrink-0 text-destructive"
            aria-hidden
          />
          <p className="min-w-0 text-xs leading-relaxed text-muted-foreground">
            bb не удалось запустить {failure.label}. Восстановлена версия{" "}
            {plugin.version} и её данные.
          </p>
        </div>
        {plugin.updateState.availableLabel === null ? (
          <PluginRangeUpgradeStatus plugin={plugin} />
        ) : null}
      </div>
    );
  }

  if (
    plugin.updateState.outcome === "unavailable" &&
    plugin.updateState.detail !== null
  ) {
    return (
      <div
        role="status"
        aria-label="Обновление требует внимания"
        className="flex min-w-0 items-start gap-2.5"
      >
        <Icon
          name="AlertTriangle"
          className="mt-0.5 size-4 shrink-0 text-warning"
          aria-hidden
        />
        <p className="min-w-0 text-xs leading-relaxed text-muted-foreground">
          {plugin.updateState.detail}
        </p>
      </div>
    );
  }

  if (plugin.updateState.availableLabel !== null) {
    return (
      <div role="status" className="flex min-w-0 items-baseline gap-2">
        <span className="font-mono text-xs text-foreground">
          {plugin.updateState.availableLabel}
        </span>
        <span className="text-xs text-muted-foreground">Доступно</span>
      </div>
    );
  }

  if (plugin.updateState.rangeUpgrade !== null) {
    return <PluginRangeUpgradeStatus plugin={plugin} />;
  }

  if (blockedVersion === null) return null;
  return (
    <div
      role="status"
      aria-label="Обновление заблокировано"
      className="flex min-w-0 items-start gap-2.5"
    >
      <Icon
        name="AlertTriangle"
        className="mt-0.5 size-4 shrink-0 text-warning"
        aria-hidden
      />
      <div className="min-w-0">
        <p className="text-xs leading-relaxed text-muted-foreground">
          {blockedReasons[0] === undefined
            ? `Версия ${blockedVersion} несовместима с этой версией bb.`
            : sentence(blockedReasons[0])}{" "}
          Версия {plugin.version} остаётся установленной. Продолжайте использовать
          её и проверьте наличие совместимого обновления позже.
        </p>
        {blockedReasons.length > 1 ? (
          <div className="mt-1.5">
            <DetailsDisclosure summary="Другие требования">
              <ul className="space-y-1 text-foreground">
                {blockedReasons.slice(1).map((reason) => (
                  <li key={reason}>{sentence(reason)}</li>
                ))}
              </ul>
            </DetailsDisclosure>
          </div>
        ) : null}
      </div>
    </div>
  );
}
