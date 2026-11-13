import { useId, type FormEvent, type RefObject } from "react";
import { Button } from "./button";
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./dialog";
import { Input } from "./input";
import { RenameDialog } from "./rename-dialog";
import {
  useRenameSession,
  type RenameController,
  type RenameSession,
} from "./inline-rename";

const RENAME_KIND_LABELS: Record<
  RenameSession["kind"],
  { target: string; owner: string }
> = {
  thread: { target: "чат", owner: "чата" },
  project: { target: "проект", owner: "проекта" },
  section: { target: "раздел", owner: "раздела" },
  environment: { target: "окружение", owner: "окружения" },
  machine: { target: "машину", owner: "машины" },
};

export function RenameSessionDialog({
  controller,
}: {
  controller: RenameController;
}) {
  const session = useRenameSession(controller);
  const open = session?.presentation === "dialog";
  return (
    <RenameDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) controller.cancel();
      }}
      shellClassName="max-w-[24rem] sm:gap-3 sm:p-5"
    >
      {(inputRef) =>
        session?.presentation === "dialog" ? (
          <RenameSessionDialogContent
            session={session}
            controller={controller}
            inputRef={inputRef}
          />
        ) : null
      }
    </RenameDialog>
  );
}

function RenameSessionDialogContent({
  session,
  controller,
  inputRef,
}: {
  session: RenameSession;
  controller: RenameController;
  inputRef: RefObject<HTMLInputElement | null>;
}) {
  const inputId = useId();
  const errorId = useId();
  const isPending = Boolean(session.pending);
  const kindLabel = RENAME_KIND_LABELS[session.kind];
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void controller.save();
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Переименовать {kindLabel.target}</DialogTitle>
        <DialogDescription>
          Выберите новое название для {kindLabel.owner}.
        </DialogDescription>
      </DialogHeader>
      <form className="space-y-3" onSubmit={handleSubmit}>
        <div className="space-y-1.5">
          <Input
            ref={inputRef}
            id={inputId}
            aria-label={session.label}
            aria-invalid={Boolean(session.error)}
            aria-describedby={session.error ? errorId : undefined}
            value={session.draft}
            placeholder={session.placeholder}
            autoCapitalize="sentences"
            autoCorrect="off"
            spellCheck={false}
            readOnly={isPending || session.cannotRetry}
            onChange={(event) => controller.change(event.target.value)}
          />
          {session.error ? (
            <p id={errorId} role="alert" className="text-sm text-destructive">
              {session.error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          {session.onClear && session.name ? (
            <Button
              type="button"
              variant="outline"
              disabled={isPending || session.cannotRetry}
              onClick={() => void controller.save(true)}
            >
              Удалить пользовательское название
            </Button>
          ) : null}
          <Button type="submit" disabled={isPending || session.cannotRetry}>
            Переименовать {kindLabel.target}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
