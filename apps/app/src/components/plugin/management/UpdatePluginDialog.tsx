import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PluginApplyUpdateRequest } from "@bb/server-contract";
import { UPDATE_ACTION_ICON } from "@bb/domain/update-state";
import { Button } from "@bb/shared-ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import { Icon } from "@bb/shared-ui/icon";
import { usePluginNotificationAction } from "@/components/plugin/PluginNotificationDescription";
import { appToast } from "@/components/ui/app-toast";
import { pluginAdminErrorMessage } from "@/lib/plugin-admin-error";
import { applyPluginUpdateJob } from "@/hooks/cache-owners/plugin-cache-owner";
import { startPluginUpdate } from "@/hooks/queries/plugin-update-job-queries";
import type { PluginListItem } from "@/hooks/queries/plugin-settings-queries";
import { reviewableRangeUpgrade } from "./plugin-status";
import {
  DetailsDisclosure,
  formatAbsoluteDate,
  KeyValueGrid,
  RollbackNote,
  SUCCESS_TEXT_STYLE,
} from "./plugin-ui";

interface UpdatePluginDialogProps {
  plugin: PluginListItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function UpdatePluginDialog({
  plugin,
  open,
  onOpenChange,
}: UpdatePluginDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open ? (
          <UpdatePluginDialogContent
            plugin={plugin}
            onOpenChange={onOpenChange}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function UpdatePluginDialogContent({
  plugin,
  onOpenChange,
}: {
  plugin: PluginListItem;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const notificationAction = usePluginNotificationAction();
  const name = plugin.name ?? plugin.id;
  const state = plugin.updateState;
  const update = useMutation({
    meta: { showErrorToast: false },
    mutationFn: (request: PluginApplyUpdateRequest) =>
      startPluginUpdate(plugin.id, request),
    onSuccess: (job) => {
      applyPluginUpdateJob({ queryClient, job });
      onOpenChange(false);
    },
    onError: (error) => {
      appToast.error("Не удалось обновить плагин", {
        description: `${plugin.name ?? plugin.id} — ${pluginAdminErrorMessage(error)}`,
        action: notificationAction(plugin.id, "installed"),
      });
    },
  });

  const fromLine = `Текущая версия: ${plugin.version}`;
  const failure = state.lastFailure;
  const rangeUpgrade = reviewableRangeUpgrade(plugin);

  if (failure !== null && rangeUpgrade === null) {
    const retryVersion = state.availableLabel;
    return (
      <>
        <DialogHeader>
          <DialogTitle>Ошибка обновления</DialogTitle>
          <DialogDescription>
            {failure.at === null
              ? "Не удалось завершить обновление."
              : `Ошибка ${formatAbsoluteDate(failure.at)}.`}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-start gap-2 text-sm">
            <Icon
              name="CircleX"
              className="mt-0.5 size-4 shrink-0 text-destructive"
              aria-hidden
            />
            <span>
              bb не удалось запустить {failure.label}. Восстановлена версия{" "}
              {plugin.version} и её данные.
            </span>
          </div>
          {failure.detail.length > 0 ? (
            <DetailsDisclosure
              key="failure-details"
              summary="Технические сведения"
              defaultExpanded
            >
              <p className="break-words font-mono text-foreground">
                {failure.detail}
              </p>
            </DetailsDisclosure>
          ) : null}
          <p className="text-xs text-muted-foreground">
            {retryVersion === null
              ? `Восстановленная версия может продолжать работу. Повторите попытку, когда появится совместимое обновление.`
              : `Совместимое обновление до ${retryVersion} всё ещё доступно. Повторите попытку, когда будете готовы.`}
          </p>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Закрыть
          </Button>
          {retryVersion === null ? null : (
            <Button
              type="button"
              disabled={update.isPending}
              aria-busy={update.isPending}
              aria-label={`Повторить обновление до ${retryVersion}`}
              onClick={() => update.mutate({})}
            >
              {update.isPending ? (
                <Icon name="Spinner" className="animate-spin" />
              ) : null}
              Повторить обновление
            </Button>
          )}
        </DialogFooter>
      </>
    );
  }

  if (state.availableLabel !== null) {
    const candidate = state.availableLabel;
    return (
      <>
        <DialogHeader>
          <DialogTitle>
            Обновить {name} до {candidate}?
          </DialogTitle>
          <DialogDescription>{fromLine}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium" style={SUCCESS_TEXT_STYLE}>
              ✓
            </span>
            <span>Совместимо с вашей версией bb и SDK плагинов</span>
          </div>
          <DetailsDisclosure summary="Сведения — источник и версии">
            <KeyValueGrid
              entries={[
                { key: "Источник", value: plugin.sourceDisplay },
                { key: "Текущая версия", value: plugin.version },
                { key: "Новая версия", value: candidate },
              ]}
            />
          </DetailsDisclosure>
          <RollbackNote fromVersion={plugin.version} toVersion={candidate} />
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={update.isPending}
            onClick={() => onOpenChange(false)}
          >
            Не сейчас
          </Button>
          <Button
            type="button"
            disabled={update.isPending}
            aria-busy={update.isPending}
            onClick={() => update.mutate({})}
          >
            {update.isPending ? (
              <Icon name="Spinner" className="animate-spin" />
            ) : (
              <Icon name={UPDATE_ACTION_ICON} aria-hidden />
            )}
            Обновить
          </Button>
        </DialogFooter>
      </>
    );
  }

  if (rangeUpgrade !== null) {
    const candidate = rangeUpgrade.candidate.label;
    return (
      <>
        <DialogHeader>
          <DialogTitle>
            Обновить {name} до {candidate}?
          </DialogTitle>
          <DialogDescription>
            {fromLine}. Версия {candidate} находится за пределами диапазона{" "}
            {rangeUpgrade.currentRange}, который использует {name}. Обновление
            изменит диапазон на {rangeUpgrade.range}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {rangeUpgrade.breaking ? (
            <div className="flex items-start gap-2 text-sm">
              <Icon
                name="AlertTriangle"
                className="mt-0.5 size-4 shrink-0 text-warning"
                aria-hidden
              />
              <span>
                {candidate} может содержать несовместимые изменения. Перед обновлением ознакомьтесь с примечаниями к выпуску.
              </span>
            </div>
          ) : null}
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium" style={SUCCESS_TEXT_STYLE}>
              ✓
            </span>
            <span>Совместимо с вашей версией bb и SDK плагинов</span>
          </div>
          <DetailsDisclosure summary="Сведения — источник, версии и диапазон">
            <KeyValueGrid
              entries={[
                { key: "Источник", value: plugin.sourceDisplay },
                { key: "Текущая версия", value: plugin.version },
                { key: "Новая версия", value: candidate },
                { key: "Текущий диапазон", value: rangeUpgrade.currentRange },
                {
                  key: "Новый диапазон",
                  value:
                    rangeUpgrade.basis === "catalog"
                      ? `${rangeUpgrade.range} (указано в каталоге)`
                      : rangeUpgrade.range,
                },
              ]}
            />
          </DetailsDisclosure>
          <RollbackNote fromVersion={plugin.version} toVersion={candidate} />
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={update.isPending}
            onClick={() => onOpenChange(false)}
          >
            Не сейчас
          </Button>
          <Button
            type="button"
            disabled={update.isPending}
            aria-busy={update.isPending}
            onClick={() =>
              update.mutate({
                range: rangeUpgrade.range,
                expectedVersion: rangeUpgrade.candidate.version,
              })
            }
          >
            {update.isPending ? (
              <Icon name="Spinner" className="animate-spin" />
            ) : (
              <Icon name={UPDATE_ACTION_ICON} aria-hidden />
            )}
            Обновить до {candidate}
          </Button>
        </DialogFooter>
      </>
    );
  }

  if (state.blockedLabel !== null) {
    const blocked = state.blockedLabel;
    return (
      <>
        <DialogHeader>
          <DialogTitle>
            Обновить {name} до {blocked}?
          </DialogTitle>
          <DialogDescription>{fromLine}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm">
            <Icon
              name="AlertTriangle"
              className="size-4 shrink-0 text-warning"
              aria-hidden
            />
            <span>Версия {blocked} несовместима с этой версией bb</span>
          </div>
          <DetailsDisclosure summary="Сведения" defaultExpanded>
            <div className="space-y-1.5">
              {state.blockedReasons.length > 0 ? (
                <ul className="space-y-1">
                  {state.blockedReasons.map((reason) => (
                    <li key={reason} className="text-foreground">
                      {reason}
                    </li>
                  ))}
                </ul>
              ) : null}
              <KeyValueGrid
                entries={[
                  {
                    key: "Последняя совместимая версия",
                    value: `${plugin.version} — уже установлена`,
                  },
                ]}
              />
            </div>
          </DetailsDisclosure>
          <p className="text-xs text-subtle-foreground">
            Продолжайте использовать версию {plugin.version} и проверьте наличие
            совместимой версии плагина позже.
          </p>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Закрыть
          </Button>
          <Button type="button" disabled>
            <Icon name={UPDATE_ACTION_ICON} aria-hidden />
            Обновить
          </Button>
        </DialogFooter>
      </>
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{name} уже обновлён</DialogTitle>
        <DialogDescription>{fromLine}</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={() => onOpenChange(false)}
        >
          Закрыть
        </Button>
      </DialogFooter>
    </>
  );
}
