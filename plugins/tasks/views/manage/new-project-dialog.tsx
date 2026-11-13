import { useEffect, useMemo, useState } from "react";
import {
  selectBbProjects,
  useFolders,
  useProjects,
  useTasksQuery,
  useTasksRpc,
} from "../../shell/data.js";
import { useTasksNavigation } from "../../shell/routes.js";
import { PROJECT_PREFIX_PATTERN } from "../../shared/contract.js";
import { errorMessage } from "../../shared/errors.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import {
  ColorSwatchPicker,
  DEFAULT_COLOR,
  describeCreateProjectError,
  derivePrefix,
  Field,
} from "./shared.js";
import { BbProjectLinkPicker } from "./bb-project-link.js";

const NO_FOLDER = "__none__";
const NEW_FOLDER = "__new__";

interface NewProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NewProjectDialog({
  open,
  onOpenChange,
}: NewProjectDialogProps) {
  const rpc = useTasksRpc();
  const navigation = useTasksNavigation();
  const projects = useProjects();
  const folders = useFolders();

  const [name, setName] = useState("");
  const [prefix, setPrefix] = useState("");
  const [prefixTouched, setPrefixTouched] = useState(false);
  const [color, setColor] = useState<string>(DEFAULT_COLOR);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [newFolderMode, setNewFolderMode] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [linkedBbProjectId, setLinkedBbProjectId] = useState<string | null>(
    null,
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bbProjects = useTasksQuery("listBbProjects", null, selectBbProjects);
  const bbProjectList = bbProjects.data ?? [];

  useEffect(() => {
    if (!open) return;
    setName("");
    setPrefix("");
    setPrefixTouched(false);
    setColor(DEFAULT_COLOR);
    setFolderId(null);
    setNewFolderMode(false);
    setNewFolderName("");
    setLinkedBbProjectId(null);
    setError(null);
  }, [open]);

  const prefixError = useMemo(() => {
    if (prefix === "") return null;
    if (!PROJECT_PREFIX_PATTERN.test(prefix)) {
      return "Используйте от 1 до 10 заглавных латинских букв и цифр; начните с буквы.";
    }
    const clash = (projects.data ?? []).find(
      (project) => project.prefix.toUpperCase() === prefix.toUpperCase(),
    );
    return clash ? `Уже используется проектом «${clash.name}».` : null;
  }, [prefix, projects.data]);

  const canSubmit =
    name.trim().length > 0 &&
    prefix.length > 0 &&
    prefixError === null &&
    !submitting;

  const folderList = folders.data ?? [];
  const folderName = (id: string) => {
    const folder = folderList.find((entry) => entry.id === id);
    if (!folder) return "Папка";
    const parent = folder.parentFolderId
      ? folderList.find((entry) => entry.id === folder.parentFolderId)
      : null;
    return parent ? `${parent.name} / ${folder.name}` : folder.name;
  };

  const createFolderInline = async () => {
    const trimmed = newFolderName.trim();
    if (trimmed === "") return;
    setError(null);
    try {
      const { folder } = await rpc.call("createFolder", {
        name: trimmed,
        parentFolderId: null,
      });
      setFolderId(folder.id);
      setNewFolderMode(false);
      setNewFolderName("");
    } catch (folderError) {
      setError(errorMessage(folderError));
    }
  };

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const { project } = await rpc.call("createProject", {
        name: name.trim(),
        prefix,
        color,
        folderId,
        linkedBbProjectId,
      });
      onOpenChange(false);
      navigation.go({ kind: "project", projectId: project.id, view: null });
    } catch (submitError) {
      setError(describeCreateProjectError(submitError));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-md"
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void submit();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>Новый проект</DialogTitle>
          <DialogDescription>
            Проекты объединяют задачи общим префиксом ключа.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field label="Название">
            <Input
              autoFocus
              value={name}
              placeholder="например, плагин задач"
              onChange={(event) => {
                setName(event.target.value);
                if (!prefixTouched) setPrefix(derivePrefix(event.target.value));
              }}
              className="h-8"
            />
          </Field>
          <Field
            label="Префикс"
            hint={
              prefixError ??
              "Ключи задач используют этот префикс, например TSK-12. Заглавные латинские буквы; значение должно быть уникальным."
            }
          >
            <Input
              value={prefix}
              placeholder="TSK"
              aria-invalid={prefixError !== null}
              onChange={(event) => {
                setPrefixTouched(true);
                setPrefix(event.target.value.toUpperCase());
              }}
              className={
                prefixError !== null
                  ? "h-8 w-32 border-destructive focus-visible:ring-destructive"
                  : "h-8 w-32"
              }
            />
          </Field>
          <Field label="Цвет">
            <ColorSwatchPicker value={color} onChange={setColor} />
          </Field>
          <Field label="Папка">
            <Select
              value={newFolderMode ? NEW_FOLDER : (folderId ?? NO_FOLDER)}
              onValueChange={(value) => {
                if (value === NEW_FOLDER) {
                  setNewFolderMode(true);
                  return;
                }
                setNewFolderMode(false);
                setFolderId(value === NO_FOLDER ? null : value);
              }}
            >
              <SelectTrigger aria-label="Папка" className="h-8">
                <SelectValue>
                  {newFolderMode
                    ? "Новая папка…"
                    : folderId
                      ? folderName(folderId)
                      : "Без папки"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_FOLDER}>Без папки</SelectItem>
                {folderList.map((folder) => (
                  <SelectItem key={folder.id} value={folder.id}>
                    {folderName(folder.id)}
                  </SelectItem>
                ))}
                <SelectSeparator />
                <SelectItem value={NEW_FOLDER}>Новая папка…</SelectItem>
              </SelectContent>
            </Select>
            {newFolderMode ? (
              <div className="mt-1.5 flex items-center gap-1.5">
                <Input
                  autoFocus
                  value={newFolderName}
                  placeholder="Название папки"
                  onChange={(event) => setNewFolderName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void createFolderInline();
                    }
                  }}
                  className="h-7 text-xs"
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7"
                  disabled={newFolderName.trim() === ""}
                  onClick={() => void createFolderInline()}
                >
                  <Icon name="FolderPlus" className="size-3.5" />
                  Создать
                </Button>
              </div>
            ) : null}
          </Field>
          <Field
            label="Связанный проект bb"
            hint="Необязательно. Связь с проектом bb позволяет назначать задачи агентам."
          >
            <BbProjectLinkPicker
              value={linkedBbProjectId}
              onChange={setLinkedBbProjectId}
              bbProjects={bbProjectList}
            />
          </Field>
        </div>
        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button size="sm" disabled={!canSubmit} onClick={() => void submit()}>
            Создать проект
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
