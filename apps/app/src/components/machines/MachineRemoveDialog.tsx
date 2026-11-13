import type { Host } from "@bb/domain";
import { Button } from "@bb/shared-ui/button";
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import { ConfirmDeleteDialog } from "@bb/shared-ui/confirm-delete-dialog";
import { useRemoveHost } from "@/hooks/mutations/host-mutations";
import { canForceRemoveMachine } from "@/components/machines/machine-status";
import { useMachineThreadPreview } from "@/hooks/queries/thread-queries";
import { getMutationErrorMessage } from "@/lib/mutation-errors";
import { getThreadDisplayTitle } from "@/lib/thread-title";

const MACHINE_THREAD_PREVIEW_LIMIT = 5;

export function serverMachineRemoveDisabledReason(
  serverMoveEnabled: boolean,
): string {
  return serverMoveEnabled
    ? "Серверную машину нельзя удалить. Сначала перенесите сервер на другую машину."
    : "Серверную машину нельзя удалить.";
}

export function machineRemovalConsequences(host: Host): string {
  if (host.type === "ephemeral") {
    return "Вычислительный ресурс и сохранённые снимки будут удалены. Среды останутся в истории только для чтения.";
  }
  if (host.machineProviderId !== null) {
    return "Провайдер очистит принадлежащие ему ресурсы. Среды останутся в истории только для чтения.";
  }
  return "Рабочие деревья проектов останутся на диске, но среды будут доступны только для чтения. Машина не сможет выполнять новые задачи до повторного подключения.";
}

function MachineThreadPreviewList({ hostId }: { hostId: string }) {
  const preview = useMachineThreadPreview({
    hostId,
    limit: MACHINE_THREAD_PREVIEW_LIMIT,
  });
  if (preview.data === undefined || preview.data.total === 0) return null;
  const { threads, total } = preview.data;
  const hiddenCount = total - threads.length;
  const summary =
    total === 1
      ? "Неархивированных чатов на этой машине: 1"
      : `Неархивированных чатов на этой машине: ${total}`;
  return (
    <div className="space-y-1 text-sm text-muted-foreground">
      <p>{summary}</p>
      <ul className="list-disc space-y-0.5 pl-5 text-foreground marker:text-subtle-foreground">
        {threads.map((thread) => (
          <li key={thread.id}>
            <span className="block truncate">
              {getThreadDisplayTitle(thread)}
            </span>
          </li>
        ))}
      </ul>
      {hiddenCount > 0 ? <p>и ещё {hiddenCount}</p> : null}
    </div>
  );
}

export function MachineRemoveDialog({
  target,
  onOpenChange,
  onRemoved,
}: {
  target: Host | null;
  onOpenChange: (open: boolean) => void;
  onRemoved?: (host: Host) => void;
}) {
  const removeHost = useRemoveHost();
  const force = target !== null && canForceRemoveMachine(target);

  return (
    <ConfirmDeleteDialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open && !removeHost.isPending) {
          removeHost.reset();
          onOpenChange(false);
        }
      }}
    >
      {target === null ? null : (
        <>
          <DialogHeader>
            <DialogTitle>Удалить {target.name}?</DialogTitle>
            <DialogDescription>
              {force ? (
                <>
                  Очистка не удалась, а {target.name} не подключена. При удалении
                  машины её среды не будут очищены: файлы и рабочие деревья
                  останутся на диске, а среды станут доступны только для чтения.
                  Провайдер машины всё равно удалит свои ресурсы. Используйте
                  это действие, только если машина недоступна навсегда.
                </>
              ) : (
                <>
                  Машина {target.name} потеряет доступ к этому серверу.{" "}
                  {machineRemovalConsequences(target)}
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <MachineThreadPreviewList hostId={target.id} />
          {removeHost.isError ? (
            <p className="text-sm text-destructive" role="alert">
              {getMutationErrorMessage({
                error: removeHost.error,
                fallbackMessage: `Не удалось удалить ${target.name}.`,
              })}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="destructive"
              disabled={removeHost.isPending}
              onClick={() =>
                removeHost.mutate(
                  { hostId: target.id, force },
                  {
                    onSuccess: () => {
                      onOpenChange(false);
                      onRemoved?.(target);
                    },
                  },
                )
              }
            >
              {force ? "Всё равно удалить" : "Удалить машину"}
            </Button>
          </DialogFooter>
        </>
      )}
    </ConfirmDeleteDialog>
  );
}
