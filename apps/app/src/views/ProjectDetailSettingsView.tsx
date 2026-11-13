import { ScopedMachineEnvironmentSettings } from "@/components/settings/MachineEnvironmentSettings";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import "@bb/shared-ui/icon-extended";
import {
  findLocalPathProjectSourceForHost,
  type Host,
  type LocalPathProjectSource,
} from "@bb/domain";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { Pill } from "@bb/shared-ui/pill";
import { ResourceOverflowMenu } from "@bb/shared-ui/resource-list";
import { ProjectPathDialog } from "@/components/dialogs/ProjectPathDialog";
import {
  ProjectDeleteDialog,
  type ProjectDeleteDialogTarget,
} from "@/components/dialogs/ProjectDeleteDialog";
import {
  ProjectMachineSetupDialog,
  type ProjectMachineSetupDialogTarget,
} from "@/components/dialogs/ProjectMachineSetupDialog";
import {
  ProjectRenameDialog,
  type ProjectRenameDialogTarget,
} from "@/components/dialogs/ProjectRenameDialog";
import {
  ProjectSourceDeleteDialog,
  type ProjectSourceDeleteDialogTarget,
} from "@/components/dialogs/ProjectSourceDeleteDialog";
import { MachineStatusDot } from "@/components/machines/MachineStatusDot";
import {
  formatGitRemote,
  pluralize,
} from "@/components/settings/ProjectsSettingsSection";
import { PageShell } from "@/components/ui/page-shell.js";
import {
  SettingsBadge,
  SettingsDetailRow,
  SettingsRow,
  SettingsRowList,
  SettingsSection,
} from "@/components/ui/settings-section";
import {
  useAddLocalProjectSource,
  useDeleteLocalProjectSource,
  useDeleteProject,
  useUpdateLocalProjectSource,
  useUpdateProject,
} from "@/hooks/mutations/project-mutations";
import {
  isHostPathMissing,
  useHostPathExistence,
} from "@/hooks/queries/host-path-queries";
import { selectHosts, useHosts } from "@/hooks/queries/host-queries";
import { useProjectDefaultExecutionOptions } from "@/hooks/queries/project-default-execution-options-query";
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import {
  useLocalPathPicker,
  type LocalPathSubmitParams,
} from "@/hooks/useLocalPathPicker";
import { PERMISSION_MODE_OPTIONS } from "@/lib/permission-mode-options";
import { formatRelativeTime } from "@/lib/relative-time";
import {
  getSettingsMachineRoutePath,
  getSettingsRoutePath,
} from "@/lib/route-paths";

const CHECKOUTS_DESCRIPTION =
  "Расположение проекта на каждой машине. Чтобы запускать чаты проекта, машине нужна локальная копия.";

const DEFAULTS_DESCRIPTION =
  "Начальные параметры новых чатов проекта. bb запоминает последние выбранные здесь параметры.";

interface CheckoutRowProps {
  host: Host;
  isPrimary: boolean;
  source: LocalPathProjectSource | null;
  isPathInvalid: boolean;
  isOnlySource: boolean;
  pending: boolean;
  onSetUp: () => void;
  onChangePath: () => void;
  onRemove: () => void;
}

function CheckoutRow({
  host,
  isPrimary,
  source,
  isPathInvalid,
  isOnlySource,
  pending,
  onSetUp,
  onChangePath,
  onRemove,
}: CheckoutRowProps) {
  const connected = host.status === "connected";
  return (
    <SettingsRow className="items-start">
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <Icon
            name="Laptop"
            className={cn(
              "size-4 shrink-0 text-muted-foreground",
              !connected && "opacity-60",
            )}
          />
          <MachineStatusDot connected={connected} />
          <Link
            to={getSettingsMachineRoutePath(host.id)}
            className="min-w-0 truncate text-sm font-medium text-foreground hover:underline"
          >
            {host.name}
          </Link>
          {isPrimary ? <SettingsBadge>основная</SettingsBadge> : null}
          {isPathInvalid ? (
            <Pill variant="destructive">Путь не найден</Pill>
          ) : null}
        </div>
        <div className="min-w-0 truncate font-mono text-xs text-subtle-foreground/75">
          {source === null ? (
            <span className="font-sans italic">Не настроено на этой машине</span>
          ) : (
            source.path
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {source === null ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending || !connected}
            onClick={onSetUp}
          >
            {connected ? "Настроить" : "Не в сети"}
          </Button>
        ) : (
          <ResourceOverflowMenu
            label={`Действия с локальной копией на ${host.name}`}
            items={[
              {
                label: "Изменить папку",
                icon: "Folder",
                disabled: !connected || pending,
                disabledReason: connected
                  ? undefined
                  : "Подключите машину к сети, чтобы изменить папку.",
                onSelect: onChangePath,
              },
              {
                label: "Удалить локальную копию",
                icon: "Trash2",
                tone: "destructive",
                disabled: isOnlySource || pending,
                disabledReason: isOnlySource
                  ? "У проекта должна быть хотя бы одна локальная копия."
                  : undefined,
                onSelect: onRemove,
              },
            ]}
          />
        )}
      </div>
    </SettingsRow>
  );
}

function LoadingShell({ children }: { children: ReactNode }) {
  return (
    <PageShell contentClassName="pt-4 md:pt-5">
      <div className="mx-auto w-full max-w-3xl space-y-3">
        <Link
          to={getSettingsRoutePath("projects")}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <Icon name="ChevronLeft" className="size-3.5" />
          Проекты
        </Link>
        {children}
      </div>
    </PageShell>
  );
}

export function ProjectDetailSettingsView() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const sidebarNavigationQuery = useSidebarNavigation();
  const hostsQuery = useHosts();
  const systemConfig = useSystemConfig();
  const defaultsQuery = useProjectDefaultExecutionOptions({ projectId });
  const updateProject = useUpdateProject();
  const deleteProject = useDeleteProject();
  const addLocalSource = useAddLocalProjectSource();
  const updateLocalSource = useUpdateLocalProjectSource();
  const deleteSource = useDeleteLocalProjectSource();

  const [renameTarget, setRenameTarget] =
    useState<ProjectRenameDialogTarget | null>(null);
  const [deleteTarget, setDeleteTarget] =
    useState<ProjectDeleteDialogTarget | null>(null);
  const [sourceDeleteTarget, setSourceDeleteTarget] =
    useState<ProjectSourceDeleteDialogTarget | null>(null);
  const [machineSetupTarget, setMachineSetupTarget] =
    useState<ProjectMachineSetupDialogTarget | null>(null);

  const projects = sidebarNavigationQuery.data?.projects;
  const project = projects?.find((entry) => entry.id === projectId) ?? null;
  const projectSources = project?.sources;
  const sources = useMemo(() => projectSources ?? [], [projectSources]);
  const projectName = project?.name ?? "";
  const everyHost = useMemo(
    () => selectHosts(hostsQuery.data, "all"),
    [hostsQuery.data],
  );
  const persistentHosts = useMemo(
    () => selectHosts(hostsQuery.data, "persistent"),
    [hostsQuery.data],
  );
  const [showAllMachines, setShowAllMachines] = useState(false);
  const hosts = showAllMachines ? everyHost : persistentHosts;
  const hiddenMachineCount = everyHost.length - persistentHosts.length;
  const primaryHostId = systemConfig.data?.primaryHostId ?? null;

  const localSourcePending =
    addLocalSource.isPending || updateLocalSource.isPending;
  const localSourceSubmit = useCallback(
    ({ path, hostId, target, closeDialog }: LocalPathSubmitParams) => {
      if (!projectId) return;
      if (target.kind === "add-source") {
        addLocalSource.mutate(
          { projectId, path, hostId },
          { onSuccess: closeDialog },
        );
      } else if (target.kind === "update") {
        const source = sources.find((candidate) => candidate.hostId === hostId);
        if (!source) return;
        updateLocalSource.mutate(
          { projectId, sourceId: source.id, path },
          { onSuccess: closeDialog },
        );
      }
    },
    [addLocalSource, projectId, sources, updateLocalSource],
  );
  const localSourcePicker = useLocalPathPicker({
    isPending: localSourcePending,
    submit: localSourceSubmit,
  });
  const pickerHostId = localSourcePicker.hostId;
  const pickerHostSourcePaths = useMemo(
    () =>
      pickerHostId
        ? sources
            .filter((source) => source.hostId === pickerHostId)
            .map((source) => source.path)
        : [],
    [pickerHostId, sources],
  );
  const pathExistence = useHostPathExistence(
    pickerHostId,
    pickerHostSourcePaths,
  );

  const openSetUp = useCallback(
    (host: Host) => {
      if (!project) return;
      if (host.id === pickerHostId) {
        localSourcePicker.openPicker({
          kind: "add-source",
          projectId: project.id,
          projectName: project.name,
        });
        return;
      }
      setMachineSetupTarget({
        projectId: project.id,
        projectName: project.name,
        gitRemoteUrl: project.gitRemoteUrl,
        hostId: host.id,
        hostName: host.name,
      });
    },
    [localSourcePicker, pickerHostId, project],
  );

  if (sidebarNavigationQuery.isError || hostsQuery.isError) {
    return (
      <LoadingShell>
        <p className="text-sm text-destructive" role="alert">
          Не удалось загрузить проект.
        </p>
      </LoadingShell>
    );
  }

  if (projects === undefined || hostsQuery.data === undefined) {
    return (
      <LoadingShell>
        <p className="text-sm text-muted-foreground">Загрузка…</p>
      </LoadingShell>
    );
  }

  if (project === null) {
    return (
      <LoadingShell>
        <p className="text-sm text-muted-foreground">
          Этого проекта больше нет.
        </p>
      </LoadingShell>
    );
  }

  const remoteLabel =
    project.gitRemoteUrl === null
      ? null
      : formatGitRemote(project.gitRemoteUrl);
  const configuredHostIds = new Set(sources.map((source) => source.hostId));
  const configuredCount = hosts.filter((host) =>
    configuredHostIds.has(host.id),
  ).length;
  const defaults = defaultsQuery.data ?? null;
  const permissionLabel =
    defaults === null
      ? null
      : (PERMISSION_MODE_OPTIONS.find(
          (option) => option.value === defaults.permissionMode,
        )?.label ?? defaults.permissionMode);
  const now = Date.now();

  return (
    <PageShell contentClassName="pt-4 md:pt-5">
      <div className="mx-auto w-full max-w-3xl space-y-6 pb-10">
        <div className="space-y-3">
          <Link
            to={getSettingsRoutePath("projects")}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <Icon name="ChevronLeft" className="size-3.5" />
            Проекты
          </Link>
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <Icon
                  name="FolderGit"
                  className="size-4 shrink-0 text-muted-foreground"
                />
                <h1 className="min-w-0 truncate text-sm font-semibold text-foreground">
                  {project.name}
                </h1>
                {configuredCount === 0 ? (
                  <SettingsBadge>требуется настройка</SettingsBadge>
                ) : null}
              </div>
              <p className="mt-1 min-w-0 truncate text-xs text-subtle-foreground/75">
                {remoteLabel ?? "Нет удалённого Git-репозитория"}
                {" · "}
                {hosts.length > 1
                  ? `${configuredCount} из ${pluralize(hosts.length, "machine")}`
                  : pluralize(configuredCount, "machine")}
                {" · "}
                {pluralize(project.threads.length, "thread")}
              </p>
            </div>
            <ResourceOverflowMenu
              label={`Действия с проектом ${project.name}`}
              items={[
                {
                  label: "Переименовать",
                  icon: "Edit",
                  onSelect: () => {
                    updateProject.reset();
                    setRenameTarget({
                      id: project.id,
                      currentName: project.name,
                    });
                  },
                },
              ]}
            />
          </div>
        </div>

        <SettingsSection title="Локальные копии" description={CHECKOUTS_DESCRIPTION}>
          {hosts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Пока нет подключённых машин.
            </p>
          ) : (
            <SettingsRowList>
              {hosts.map((host) => {
                const source = findLocalPathProjectSourceForHost(
                  sources,
                  host.id,
                );
                const isPickerHost = host.id === pickerHostId;
                return (
                  <CheckoutRow
                    key={host.id}
                    host={host}
                    isPrimary={hosts.length > 1 && host.id === primaryHostId}
                    source={source ?? null}
                    isPathInvalid={
                      source !== undefined &&
                      isPickerHost &&
                      isHostPathMissing(pathExistence, source.path)
                    }
                    isOnlySource={sources.length <= 1}
                    pending={localSourcePending || deleteSource.isPending}
                    onSetUp={() => openSetUp(host)}
                    onChangePath={() => {
                      if (!source) return;
                      localSourcePicker.openPicker({
                        kind: "update",
                        projectId: project.id,
                        projectName,
                        currentPath: source.path,
                        hostId: host.id,
                        hostName: host.name,
                      });
                    }}
                    onRemove={() => {
                      if (!source) return;
                      setSourceDeleteTarget({
                        id: source.id,
                        label: `${host.name} · ${source.path}`,
                      });
                    }}
                  />
                );
              })}
            </SettingsRowList>
          )}
          {hiddenMachineCount > 0 ? (
            <button
              type="button"
              aria-expanded={showAllMachines}
              onClick={() => setShowAllMachines((previous) => !previous)}
              className="-ml-1 inline-flex items-center gap-1.5 self-start rounded-md px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground"
            >
              <Icon
                name="ChevronDown"
                className={cn(
                  "size-3.5 transition-transform",
                  showAllMachines && "rotate-180",
                )}
                aria-hidden
              />
              <span>
                {showAllMachines ? "Показать меньше машин" : "Показать все машины"}
              </span>
            </button>
          ) : null}
        </SettingsSection>

        <SettingsSection
          title="Параметры чатов по умолчанию"
          description={DEFAULTS_DESCRIPTION}
        >
          {defaultsQuery.isError ? (
            <p className="text-sm text-destructive" role="alert">
              Не удалось загрузить параметры чатов по умолчанию.
            </p>
          ) : defaultsQuery.isPending ? (
            <p className="text-sm text-muted-foreground">Загрузка…</p>
          ) : defaults === null ? (
            <p className="text-sm text-muted-foreground">
              Здесь ещё не запускались чаты. Параметры первого чата станут
              настройками по умолчанию.
            </p>
          ) : (
            <SettingsRowList>
              <SettingsDetailRow label="Провайдер">
                <span>{defaults.providerId}</span>
              </SettingsDetailRow>
              <SettingsDetailRow label="Модель">
                <span className="font-mono text-xs">{defaults.model}</span>
              </SettingsDetailRow>
              <SettingsDetailRow label="Режим разрешений">
                <span>{permissionLabel}</span>
              </SettingsDetailRow>
              <SettingsDetailRow label="Уровень рассуждения">
                <span>{defaults.reasoningLevel}</span>
              </SettingsDetailRow>
            </SettingsRowList>
          )}
        </SettingsSection>

        <SettingsSection title="Сведения о проекте">
          <SettingsRowList>
            <SettingsDetailRow label="Удалённый Git-репозиторий">
              {project.gitRemoteUrl === null ? (
                <span>Не найден</span>
              ) : (
                <span className="min-w-0 truncate font-mono text-xs">
                  {project.gitRemoteUrl}
                </span>
              )}
            </SettingsDetailRow>
            <SettingsDetailRow label="ID проекта">
              <span className="font-mono text-xs">{project.id}</span>
            </SettingsDetailRow>
            <SettingsDetailRow label="Создан">
              <span>
                {formatRelativeTime({ timestamp: project.createdAt, now })}
              </span>
            </SettingsDetailRow>
          </SettingsRowList>
        </SettingsSection>

        <ScopedMachineEnvironmentSettings projectId={project.id} />

        <SettingsSection
          title="Опасная зона"
          description={`При удалении проекта ${project.name} удалятся все его чаты, включая архивные. Локальные копии останутся на диске.`}
        >
          <SettingsRowList>
            <SettingsRow>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={() => {
                  deleteProject.reset();
                  setDeleteTarget({ id: project.id, name: project.name });
                }}
              >
                Удалить проект
              </Button>
            </SettingsRow>
          </SettingsRowList>
        </SettingsSection>
      </div>

      <ProjectPathDialog
        target={localSourcePicker.projectPathDialog.target}
        pending={localSourcePending}
        platform={localSourcePicker.platform}
        hostId={localSourcePicker.hostId}
        hostName={localSourcePicker.hostName}
        onOpenChange={localSourcePicker.projectPathDialog.onOpenChange}
        onSubmit={localSourcePicker.submitProjectPath}
      />

      <ProjectMachineSetupDialog
        target={machineSetupTarget}
        onOpenChange={(open) => {
          if (!open) setMachineSetupTarget(null);
        }}
        onComplete={() => setMachineSetupTarget(null)}
      />

      <ProjectSourceDeleteDialog
        target={sourceDeleteTarget}
        pending={deleteSource.isPending}
        onOpenChange={(open) => {
          if (!open) setSourceDeleteTarget(null);
        }}
        onDelete={(sourceId) =>
          deleteSource.mutate(
            { projectId: project.id, sourceId },
            { onSuccess: () => setSourceDeleteTarget(null) },
          )
        }
      />

      <ProjectRenameDialog
        target={renameTarget}
        pending={updateProject.isPending}
        onOpenChange={(open) => {
          if (!open && !updateProject.isPending) setRenameTarget(null);
        }}
        onRename={(id, name) =>
          updateProject.mutate(
            { id, name },
            { onSuccess: () => setRenameTarget(null) },
          )
        }
      />

      <ProjectDeleteDialog
        target={deleteTarget}
        pending={deleteProject.isPending}
        onOpenChange={(open) => {
          if (!open && !deleteProject.isPending) setDeleteTarget(null);
        }}
        onDelete={(id) =>
          deleteProject.mutate(id, {
            onSuccess: () => {
              setDeleteTarget(null);
              void navigate(getSettingsRoutePath("projects"), {
                replace: true,
              });
            },
          })
        }
      />
    </PageShell>
  );
}
