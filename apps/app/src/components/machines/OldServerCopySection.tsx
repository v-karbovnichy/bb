import { useState } from "react";
import type { Host, LastServerMove } from "@bb/domain";
import { Button } from "@bb/shared-ui/button";
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import { ConfirmDeleteDialog } from "@bb/shared-ui/confirm-delete-dialog";
import { appToast } from "@/components/ui/app-toast";
import {
  SettingsRow,
  SettingsRowList,
  SettingsSection,
} from "@/components/ui/settings-section";
import { useDeleteOldServerCopy } from "@/hooks/mutations/server-move-mutations";
import { getMutationErrorMessage } from "@/lib/mutation-errors";

export function hasOldServerCopy(
  host: Host,
  lastMove: LastServerMove | null,
): lastMove is LastServerMove {
  return (
    lastMove !== null &&
    lastMove.fromHostId === host.id &&
    lastMove.oldCopyDeletedAt === null
  );
}

export function oldServerCopyDescription(
  host: Host,
  lastMove: LastServerMove,
): string {
  const base = `Сервер перенесён с ${host.name} на ${lastMove.toHostName}. Старые данные сервера остались на ${host.name} и заблокированы, чтобы bb не запустил из них сервер. Сохраните их как резервную копию или удалите, когда новый сервер заработает.`;
  return host.status === "connected"
    ? base
    : `${base} Для удаления ${host.name} должна быть в сети.`;
}

export function OldServerCopySection({
  host,
  lastMove,
}: {
  host: Host;
  lastMove: LastServerMove;
}) {
  const deleteOldCopy = useDeleteOldServerCopy();
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <>
      <OldServerCopySectionView
        host={host}
        lastMove={lastMove}
        onDelete={() => {
          deleteOldCopy.reset();
          setConfirmOpen(true);
        }}
      />
      <ConfirmDeleteDialog
        modal={false}
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!open && !deleteOldCopy.isPending) {
            deleteOldCopy.reset();
            setConfirmOpen(false);
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>Удалить старую копию сервера?</DialogTitle>
          <DialogDescription>
            База данных, настройки и данные плагинов, оставшиеся на {host.name}
            после переноса на {lastMove.toHostName}, будут удалены безвозвратно.
            Сервер на {lastMove.toHostName} не затронут.
          </DialogDescription>
        </DialogHeader>
        {deleteOldCopy.isError ? (
          <p className="text-sm text-destructive-text" role="alert">
            {getMutationErrorMessage({
              error: deleteOldCopy.error,
              fallbackMessage: `Не удалось удалить старую копию сервера на ${host.name}.`,
            })}
          </p>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="destructive"
            disabled={deleteOldCopy.isPending}
            onClick={() =>
              deleteOldCopy.mutate(host.id, {
                onSuccess: (result) => {
                  setConfirmOpen(false);
                  appToast.success(
                    result.deleted
                      ? `Старая копия сервера на ${host.name} удалена`
                      : `На ${host.name} не осталось старой копии сервера`,
                  );
                },
              })
            }
          >
            {deleteOldCopy.isPending ? "Удаление…" : "Удалить старую копию"}
          </Button>
        </DialogFooter>
      </ConfirmDeleteDialog>
    </>
  );
}

export function OldServerCopySectionView({
  host,
  lastMove,
  onDelete,
}: {
  host: Host;
  lastMove: LastServerMove;
  onDelete: () => void;
}) {
  return (
    <SettingsSection
      title="Старая копия сервера"
      description={oldServerCopyDescription(host, lastMove)}
    >
      <SettingsRowList>
        <SettingsRow>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={host.status !== "connected"}
            onClick={onDelete}
          >
            Удалить старую копию
          </Button>
        </SettingsRow>
      </SettingsRowList>
    </SettingsSection>
  );
}
