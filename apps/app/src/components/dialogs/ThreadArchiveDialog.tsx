import { useRef } from "react";
import type { Thread } from "@bb/domain";
import { Button } from "@bb/shared-ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import { formatChildThreadCount } from "@/lib/child-thread-copy";

export interface ThreadArchiveDialogTarget {
  threads: readonly Thread[];
  childThreadCount: number;
  stopsRunningWork: boolean;
}

interface ThreadArchiveDialogProps<Target extends ThreadArchiveDialogTarget> {
  target: Target | null;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onArchive: (target: Target) => void;
}

export function ThreadArchiveDialog<Target extends ThreadArchiveDialogTarget>({
  target,
  pending,
  onOpenChange,
  onArchive,
}: ThreadArchiveDialogProps<Target>) {
  const contentRef = useRef<HTMLDivElement>(null);

  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent
        ref={contentRef}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          contentRef.current
            ?.querySelector<HTMLButtonElement>('button[type="submit"]')
            ?.focus();
        }}
      >
        {target ? (
          <ThreadArchiveDialogContent
            target={target}
            pending={pending}
            onOpenChange={onOpenChange}
            onArchive={onArchive}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

interface ThreadArchiveDialogContentProps<
  Target extends ThreadArchiveDialogTarget,
> {
  target: Target;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onArchive: (target: Target) => void;
}

export function ThreadArchiveDialogContent<
  Target extends ThreadArchiveDialogTarget,
>({
  target,
  pending,
  onOpenChange,
  onArchive,
}: ThreadArchiveDialogContentProps<Target>) {
  const { childThreadCount, threads, stopsRunningWork } = target;
  const single = threads.length === 1;

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!pending) {
          onArchive(target);
        }
      }}
    >
      <DialogHeader>
        <DialogTitle>
          {single ? "Архивировать чат?" : `Архивировать чаты (${threads.length})?`}
        </DialogTitle>
        <DialogDescription>
          {stopsRunningWork ? "Текущая задача будет остановлена. " : null}
          <span className="font-semibold">
            {formatChildThreadCount(childThreadCount)}
          </span>{" "}
          {childThreadCount === 1
            ? "тоже будет архивирован. "
            : "тоже будут архивированы. "}
          Архивные чаты остаются доступными, и их можно восстановить.
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => onOpenChange(false)}
        >
          Отмена
        </Button>
        <Button type="submit" disabled={pending}>
          Архивировать
        </Button>
      </DialogFooter>
    </form>
  );
}
