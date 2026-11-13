import { useId, useState, type FormEvent, type RefObject } from "react";
import { Button } from "@bb/shared-ui/button";
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import { Input } from "@bb/shared-ui/input";
import { useNameValidation } from "@bb/shared-ui/rename-dialog";

interface RenameDialogContentProps {
  entityLabel: string;
  initialName: string;
  pending: boolean;
  autoCapitalize: "words" | "sentences";
  onRename: (name: string) => void;
  inputRef: RefObject<HTMLInputElement | null>;
}

export function RenameDialogContent({
  entityLabel,
  initialName,
  pending,
  autoCapitalize,
  onRename,
  inputRef,
}: RenameDialogContentProps) {
  const inputId = useId();
  const [nextName, setNextName] = useState(initialName);
  const entityName = entityLabel === "project" ? "проекта" : "чата";
  const { validationMessage, validate, clearMessage } = useNameValidation({
    emptyMessage: `Имя ${entityName} не может быть пустым.`,
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;

    const trimmedName = validate(nextName);
    if (trimmedName === null) return;

    onRename(trimmedName);
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Переименовать {entityLabel === "project" ? "проект" : "чат"}</DialogTitle>
        <DialogDescription>
          Выберите новое имя {entityName}.
        </DialogDescription>
      </DialogHeader>
      <form
        className="space-y-4"
        onSubmit={handleSubmit}
      >
        <div className="space-y-2">
          <Input
            ref={inputRef}
            id={inputId}
            aria-label={`Название ${entityName}`}
            value={nextName}
            autoCapitalize={autoCapitalize}
            autoCorrect="off"
            spellCheck={false}
            disabled={pending}
            onChange={(event) => {
              setNextName(event.target.value);
              clearMessage();
            }}
          />
          {validationMessage ? (
            <p className="text-sm text-destructive">{validationMessage}</p>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="submit" disabled={pending}>
            Переименовать {entityLabel === "project" ? "проект" : "чат"}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
