import { useMemo, useState } from "react";
import type { Folder, Label, Preset } from "../../shared/contract.js";
import { errorMessage } from "../../shared/errors.js";
import {
  selectLabels,
  selectMachines,
  useFolders,
  usePresets,
  useProjects,
  useTasksQuery,
  useTasksRpc,
} from "../../shell/data.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import { HOVER_REVEAL_NO_HOVER_VISIBLE_CLASS } from "@/components/ui/hover-reveal";
import { cn } from "@/lib/utils";
import {
  ConfirmDeleteDialog,
  ConfirmDeleteDialogContent,
} from "@/components/ui/confirm-delete-dialog";
import {
  PERMISSION_LABELS,
  PresetDialog,
  describePresetEnvironment,
  savePresetDraft,
  type PresetDraft,
} from "./preset-dialog.js";
import { ColorSwatchPicker, DEFAULT_COLOR } from "./shared.js";

function useActionError() {
  const [error, setError] = useState<string | null>(null);
  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
    } catch (actionError) {
      setError(errorMessage(actionError));
    }
  };
  return { error, setError, run };
}

function LabelEditorRow({
  initialName,
  initialColor,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initialName: string;
  initialColor: string;
  submitLabel: string;
  onSubmit: (name: string, color: string) => Promise<void>;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [color, setColor] = useState(initialColor);
  const submit = () => {
    void onSubmit(name.trim(), color).then(() => {
      if (!onCancel) {
        setName("");
        setColor(DEFAULT_COLOR);
      }
    });
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        value={name}
        placeholder="Название метки"
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && name.trim() !== "") {
            event.preventDefault();
            submit();
          }
        }}
        className="h-7 w-44 text-xs"
      />
      <ColorSwatchPicker value={color} onChange={setColor} />
      <Button
        size="sm"
        variant="outline"
        className="h-7"
        disabled={name.trim() === ""}
        onClick={submit}
      >
        {submitLabel}
      </Button>
      {onCancel ? (
        <Button size="sm" variant="ghost" className="h-7" onClick={onCancel}>
          Отмена
        </Button>
      ) : null}
    </div>
  );
}

function LabelsSection() {
  const rpc = useTasksRpc();
  const projects = useProjects();
  const projectList = projects.data ?? [];
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null,
  );
  const projectId = selectedProjectId ?? projectList[0]?.id ?? null;
  const labels = useTasksQuery(
    "listLabels",
    { projectId: projectId ?? "" },
    selectLabels,
    { enabled: projectId !== null },
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const { error, run } = useActionError();
  const [confirmDelete, setConfirmDelete] = useState<{
    label: Label;
    usedBy: number;
  } | null>(null);

  const askDelete = (label: Label) =>
    run(async () => {
      const { tasks } = await rpc.call("listAllTasks", {
        labelIds: [label.id],
      });
      setConfirmDelete({ label, usedBy: tasks.length });
    });

  if (projectList.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Сначала создайте проект: метки принадлежат проекту.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <Select
        value={projectId ?? undefined}
        onValueChange={(value) => {
          setSelectedProjectId(value);
          setEditingId(null);
        }}
      >
        <SelectTrigger aria-label="Проект" className="h-8 w-56">
          <SelectValue placeholder="Проект" />
        </SelectTrigger>
        <SelectContent>
          {projectList.map((project) => (
            <SelectItem key={project.id} value={project.id}>
              <span className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="size-2.5 rounded-sm"
                  style={{ backgroundColor: project.color }}
                />
                {project.name}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="divide-y divide-border-hairline rounded-md border border-border">
        {(labels.data ?? []).map((label) => (
          <div key={label.id} className="px-3 py-2">
            {editingId === label.id ? (
              <LabelEditorRow
                initialName={label.name}
                initialColor={label.color}
                submitLabel="Сохранить"
                onCancel={() => setEditingId(null)}
                onSubmit={(name, color) =>
                  run(async () => {
                    await rpc.call("updateLabel", {
                      labelId: label.id,
                      name,
                      color,
                    });
                    setEditingId(null);
                  })
                }
              />
            ) : (
              <div className="group flex items-center gap-2">
                <span
                  aria-hidden
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: label.color }}
                />
                <span className="flex-1 text-sm">{label.name}</span>
                <Button
                  size="icon"
                  variant="ghost"
                  className={cn(
                    "size-6 text-muted-foreground opacity-0 group-hover:opacity-100",
                    HOVER_REVEAL_NO_HOVER_VISIBLE_CLASS,
                  )}
                  aria-label={`Изменить метку ${label.name}`}
                  onClick={() => setEditingId(label.id)}
                >
                  <Icon name="Edit" className="size-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className={cn(
                    "size-6 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100",
                    HOVER_REVEAL_NO_HOVER_VISIBLE_CLASS,
                  )}
                  aria-label={`Удалить метку ${label.name}`}
                  onClick={() => void askDelete(label)}
                >
                  <Icon name="Trash2" className="size-3.5" />
                </Button>
              </div>
            )}
          </div>
        ))}
        {(labels.data ?? []).length === 0 ? (
          <p className="px-3 py-2 text-sm text-muted-foreground">
            Меток пока нет.
          </p>
        ) : null}
      </div>
      <LabelEditorRow
        initialName=""
        initialColor={DEFAULT_COLOR}
        submitLabel="Добавить метку"
        onSubmit={(name, color) =>
          run(async () => {
            if (!projectId) return;
            await rpc.call("createLabel", { projectId, name, color });
          })
        }
      />
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      <ConfirmDeleteDialog
        className="max-w-sm"
        open={confirmDelete !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDelete(null);
        }}
      >
        {confirmDelete ? (
          <ConfirmDeleteDialogContent
            title={`Удалить метку «${confirmDelete.label.name}»?`}
            description={
              confirmDelete.usedBy > 0
                ? `Метка используется в задачах (${confirmDelete.usedBy}). При удалении она будет откреплена от них.`
                : "Эта метка не используется в задачах."
            }
            confirmLabel="Удалить метку"
            pending={false}
            size="sm"
            onCancel={() => setConfirmDelete(null)}
            onConfirm={() => {
              setConfirmDelete(null);
              void run(() =>
                rpc.call("deleteLabel", { labelId: confirmDelete.label.id }),
              );
            }}
          />
        ) : null}
      </ConfirmDeleteDialog>
    </div>
  );
}

function PresetsSection() {
  const rpc = useTasksRpc();
  const presets = usePresets();
  const machines = useTasksQuery("listMachines", {}, selectMachines);
  const [dialog, setDialog] = useState<{
    key: number;
    editing: Preset | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = async (editing: Preset | null, draft: PresetDraft) => {
    await savePresetDraft(rpc, editing, draft);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Пресеты для назначения задачи агенту.
        </p>
        <Button
          size="sm"
          className="h-7"
          onClick={() => setDialog({ key: Date.now(), editing: null })}
        >
          <Icon name="Plus" className="size-3.5" />
          Новый пресет
        </Button>
      </div>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border-hairline text-xs text-muted-foreground">
              <th className="px-3 py-2 font-medium">Название</th>
              <th className="px-3 py-2 font-medium">Провайдер</th>
              <th className="px-3 py-2 font-medium">Модель</th>
              <th className="px-3 py-2 font-medium">Уровень рассуждений</th>
              <th className="px-3 py-2 font-medium">Уровень сервиса</th>
              <th className="px-3 py-2 font-medium">Разрешения</th>
              <th className="px-3 py-2 font-medium">Окружение</th>
              <th className="px-3 py-2 font-medium">Инструкции</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border-hairline">
            {(presets.data ?? []).map((preset) => (
              <tr key={preset.id} className="group">
                <td className="px-3 py-2">
                  <span className="flex items-center gap-2">
                    <Icon
                      name="Bot"
                      className="size-3.5 text-muted-foreground"
                    />
                    {preset.name}
                  </span>
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {preset.providerId}
                </td>
                <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                  {preset.modelId}
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {preset.reasoningLevel}
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {preset.serviceTier ?? "—"}
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {PERMISSION_LABELS[preset.permissionMode]}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                  {describePresetEnvironment(preset, machines.data ?? [])}
                </td>
                <td
                  className="max-w-48 truncate px-3 py-2 text-xs text-muted-foreground"
                  title={preset.instructions}
                >
                  {preset.instructions === "" ? "—" : preset.instructions}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={cn(
                      "flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100",
                      HOVER_REVEAL_NO_HOVER_VISIBLE_CLASS,
                    )}
                  >
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-6 text-muted-foreground"
                      aria-label={`Изменить пресет ${preset.name}`}
                      onClick={() =>
                        setDialog({ key: Date.now(), editing: preset })
                      }
                    >
                      <Icon name="Edit" className="size-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-6 text-muted-foreground hover:text-destructive"
                      aria-label={`Удалить пресет ${preset.name}`}
                      onClick={() => {
                        setError(null);
                        rpc
                          .call("deletePreset", { presetId: preset.id })
                          .catch((deleteError: unknown) =>
                            setError(errorMessage(deleteError)),
                          );
                      }}
                    >
                      <Icon name="Trash2" className="size-3.5" />
                    </Button>
                  </span>
                </td>
              </tr>
            ))}
            {(presets.data ?? []).length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-3 py-3 text-sm text-muted-foreground"
                >
                  Пресетов пока нет.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      {dialog ? (
        <PresetDialog
          key={dialog.key}
          open
          onOpenChange={(open) => {
            if (!open) setDialog(null);
          }}
          editing={dialog.editing}
          onSave={(draft) => save(dialog.editing, draft)}
        />
      ) : null}
    </div>
  );
}

const ROOT_PARENT = "__root__";

function FolderRow({
  folder,
  rootFolders,
  onRename,
  onMove,
  onDelete,
}: {
  folder: Folder;
  rootFolders: Folder[];
  onRename: (name: string) => Promise<void>;
  onMove: (parentFolderId: string | null) => Promise<void>;
  onDelete: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(folder.name);
  const parentOptions = rootFolders.filter((entry) => entry.id !== folder.id);
  const rename = () => {
    void onRename(draftName.trim()).then(() => setRenaming(false));
  };

  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <Icon name="Папка" className="size-3.5 shrink-0 text-muted-foreground" />
      {renaming ? (
        <>
          <Input
            autoFocus
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && draftName.trim() !== "") {
                event.preventDefault();
                rename();
              }
              if (event.key === "Escape") setRenaming(false);
            }}
            className="h-7 w-44 text-xs"
          />
          <Button
            size="sm"
            variant="outline"
            className="h-7"
            disabled={draftName.trim() === ""}
            onClick={rename}
          >
            Сохранить
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7"
            onClick={() => setRenaming(false)}
          >
            Отмена
          </Button>
        </>
      ) : (
        <>
          <span className="flex-1 truncate text-sm">{folder.name}</span>
          <Select
            value={folder.parentFolderId ?? ROOT_PARENT}
            onValueChange={(value) =>
              void onMove(value === ROOT_PARENT ? null : value)
            }
          >
            <SelectTrigger
              aria-label={`Родительская папка для ${folder.name}`}
              className="h-7 w-40 text-xs text-muted-foreground"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ROOT_PARENT}>Верхний уровень</SelectItem>
              {parentOptions.map((parent) => (
                <SelectItem key={parent.id} value={parent.id}>
                  {parent.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="icon"
            variant="ghost"
            className="size-6 text-muted-foreground"
            aria-label={`Переименовать папку ${folder.name}`}
            onClick={() => {
              setDraftName(folder.name);
              setRenaming(true);
            }}
          >
            <Icon name="Edit" className="size-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-6 text-muted-foreground hover:text-destructive"
            aria-label={`Удалить папку ${folder.name}`}
            onClick={onDelete}
          >
            <Icon name="Trash2" className="size-3.5" />
          </Button>
        </>
      )}
    </div>
  );
}

function FoldersSection() {
  const rpc = useTasksRpc();
  const folders = useFolders();
  const projects = useProjects();
  const { error, setError, run } = useActionError();
  const [confirmDelete, setConfirmDelete] = useState<Folder | null>(null);
  const folderList = useMemo(() => folders.data ?? [], [folders.data]);
  const rootFolders = useMemo(
    () => folderList.filter((folder) => folder.parentFolderId === null),
    [folderList],
  );

  const impactError = folders.error ?? projects.error;
  const impactReady =
    impactError === null &&
    folders.data !== undefined &&
    !folders.isLoading &&
    projects.data !== undefined &&
    !projects.isLoading;

  function describeDeleteImpact(folder: Folder): string {
    if (!impactReady) {
      return impactError !== null
        ? `Не удалось загрузить содержимое папки: ${impactError}`
        : "Проверка содержимого папки…";
    }
    const projectCount = (projects.data ?? []).filter(
      (project) => project.folderId === folder.id,
    ).length;
    const subfolderCount = folderList.filter(
      (entry) => entry.parentFolderId === folder.id,
    ).length;
    const moved = [
      projectCount > 0
        ? `проектов: ${projectCount}`
        : null,
      subfolderCount > 0
        ? `вложенных папок: ${subfolderCount}`
        : null,
    ].filter((part) => part !== null);
    return moved.length === 0
      ? "Папка пуста."
      : `На верхний уровень будут перемещены ${moved.join(", ")}. Задачи не удалятся.`;
  }

  return (
    <div className="space-y-3">
      {folderList.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Папок пока нет. Создайте папку в окне «Новый проект».
        </p>
      ) : (
        <div className="divide-y divide-border-hairline rounded-md border border-border">
          {folderList.map((folder) => (
            <FolderRow
              key={folder.id}
              folder={folder}
              rootFolders={rootFolders}
              onRename={(name) =>
                run(() =>
                  rpc.call("renameFolder", { folderId: folder.id, name }),
                )
              }
              onMove={(parentFolderId) =>
                run(() =>
                  rpc.call("moveFolder", {
                    folderId: folder.id,
                    parentFolderId,
                  }),
                )
              }
              onDelete={() => {
                setError(null);
                setConfirmDelete(folder);
              }}
            />
          ))}
        </div>
      )}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      <ConfirmDeleteDialog
        className="max-w-sm"
        open={confirmDelete !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDelete(null);
        }}
      >
        {confirmDelete ? (
          <ConfirmDeleteDialogContent
            title={`Удалить папку «${confirmDelete.name}»?`}
            description={describeDeleteImpact(confirmDelete)}
            confirmLabel="Удалить папку"
            pending={false}
            confirmDisabled={!impactReady}
            size="sm"
            onCancel={() => setConfirmDelete(null)}
            onConfirm={() => {
              setConfirmDelete(null);
              void run(async () => {
                const result = await rpc.call("deleteFolder", {
                  folderId: confirmDelete.id,
                });
                if (!result.deleted) {
                  folders.refresh();
                  projects.refresh();
                  throw new Error(
                    `Папка «${confirmDelete.name}» уже удалена.`,
                  );
                }
              });
            }}
          />
        ) : null}
      </ConfirmDeleteDialog>
    </div>
  );
}

export function ManagePanel() {
  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-4">
      <header className="space-y-1">
        <h2 className="text-base font-semibold">Управление</h2>
        <p className="text-sm text-muted-foreground">
          Метки, пресеты агентов и папки.
        </p>
      </header>
      <Tabs defaultValue="labels">
        <TabsList>
          <TabsTrigger value="labels">Метки</TabsTrigger>
          <TabsTrigger value="presets">Пресеты</TabsTrigger>
          <TabsTrigger value="folders">Папки</TabsTrigger>
        </TabsList>
        <TabsContent value="labels" className="pt-3">
          <LabelsSection />
        </TabsContent>
        <TabsContent value="presets" className="pt-3">
          <PresetsSection />
        </TabsContent>
        <TabsContent value="folders" className="pt-3">
          <FoldersSection />
        </TabsContent>
      </Tabs>
    </div>
  );
}
