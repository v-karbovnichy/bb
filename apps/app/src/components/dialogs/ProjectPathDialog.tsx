import { useEffect, useId, useState, type FormEvent } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { Icon } from "@bb/shared-ui/icon";
import {
  deriveProjectNameFromPath,
  getProjectPathValidationMessage,
  normalizeProjectPathInput,
  type Host,
} from "@bb/domain";
import type { HostPlatform } from "@bb/host-daemon-contract";
import { Button } from "@bb/shared-ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import { Input } from "@bb/shared-ui/input";
import { cn } from "@bb/shared-ui/lib/utils";
import { LazyRemotePathBrowser } from "@/components/dialogs/LazyRemotePathBrowser";
import { MachineStatusDot } from "@/components/machines/MachineStatusDot";
import { usePointerCoarse } from "@bb/shared-ui/hooks/use-pointer-coarse";
import { selectHosts } from "@/hooks/queries/host-queries";

export type ProjectPathDialogTarget =
  | {
      kind: "create";
    }
  | {
      kind: "update";
      projectId: string;
      projectName: string;
      currentPath: string;
      hostId: string;
      hostName: string;
    }
  | {
      kind: "add-source";
      projectId: string;
      projectName: string;
    };

export type ProjectPathDialogSubmitHandler = (
  target: ProjectPathDialogTarget,
  path: string,
  hostId: string | null,
) => Promise<void> | void;

interface ProjectPathDialogProps {
  target: ProjectPathDialogTarget | null;
  pending?: boolean;
  platform: HostPlatform | null;
  hostId: string | null;
  hostName: string | null;
  hosts?: readonly Host[];
  onOpenChange: (open: boolean) => void;
  onSubmit: ProjectPathDialogSubmitHandler;
}

export function ProjectPathDialog({
  target,
  pending = false,
  platform,
  hostId,
  hostName,
  hosts,
  onOpenChange,
  onSubmit,
}: ProjectPathDialogProps) {
  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        {target ? (
          <ProjectPathDialogContent
            key={target.kind === "create" ? "create" : target.projectId}
            target={target}
            pending={pending}
            platform={platform}
            hostId={hostId}
            hostName={hostName}
            hosts={hosts}
            onSubmit={onSubmit}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

interface ProjectPathDialogContentProps {
  target: ProjectPathDialogTarget;
  pending: boolean;
  platform: HostPlatform | null;
  hostId: string | null;
  hostName: string | null;
  hosts?: readonly Host[];
  onSubmit: ProjectPathDialogSubmitHandler;
}

interface PlatformCopy {
  description: string;
  placeholder: string;
}

function getDialogTitle(kind: ProjectPathDialogTarget["kind"]): string {
  switch (kind) {
    case "create":
      return "Добавить проект";
    case "update":
      return "Обновить путь к проекту";
    case "add-source":
      return "Добавить источник проекта";
  }
}

function getDialogSubmitLabel(kind: ProjectPathDialogTarget["kind"]): string {
  switch (kind) {
    case "create":
      return "Добавить проект";
    case "update":
      return "Сохранить путь";
    case "add-source":
      return "Добавить источник";
  }
}

function getPlatformCopy(
  platform: HostPlatform | null,
  hostName: string | null,
): PlatformCopy {
  const placeholder = "/path/to/project";
  const hostSuffix = hostName ? ` на ${hostName}` : "";
  if (platform === "wsl") {
    return {
      description: `Введите абсолютный путь WSL${hostSuffix} к папке проекта, например /home/me/repo или /mnt/c/...`,
      placeholder,
    };
  }
  if (platform === "win32") {
    return {
      description: `Введите абсолютный путь Windows${hostSuffix} к папке проекта, например C:\\Users\\me\\repo.`,
      placeholder: "C:\\path\\to\\project",
    };
  }
  return {
    description: `Введите абсолютный путь${hostSuffix} к папке проекта.`,
    placeholder,
  };
}

export function ProjectPathDialogContent({
  target,
  pending,
  platform,
  hostId,
  hostName,
  hosts,
  onSubmit,
}: ProjectPathDialogContentProps) {
  const inputId = useId();
  const isPointerCoarse = usePointerCoarse();
  const targetHostId = target.kind === "update" ? target.hostId : hostId;
  const targetHostName = target.kind === "update" ? target.hostName : hostName;
  const machineOptions =
    target.kind === "create" ? selectHosts(hosts, "all") : undefined;
  const firstConnectedHostId = machineOptions?.find(
    (host) => host.status === "connected",
  )?.id;
  const [selectedHostIdState, setSelectedHostId] = useState(
    targetHostId ?? firstConnectedHostId ?? null,
  );
  const selectedHostId =
    machineOptions === undefined ||
    machineOptions.some(
      (host) => host.id === selectedHostIdState && host.status === "connected",
    )
      ? selectedHostIdState
      : (firstConnectedHostId ?? null);
  const selectedHost = machineOptions?.find(
    (host) => host.id === selectedHostId,
  );
  const selectedHostName = selectedHost?.name ?? targetHostName;
  const selectedHostConnected =
    selectedHost === undefined || selectedHost.status === "connected";
  const showMachinePicker = (machineOptions?.length ?? 0) > 1;
  const noMachineAvailable =
    machineOptions !== undefined && selectedHostId === null;
  const [manualPath, setManualPath] = useState(
    target.kind === "update" ? target.currentPath : "",
  );
  const [browserDirectory, setBrowserDirectory] = useState<string | null>(
    target.kind === "update" ? target.currentPath : null,
  );
  const [validationMessage, setValidationMessage] = useState<string | null>(
    null,
  );
  const copy = getPlatformCopy(platform, selectedHostName);
  const placeholder =
    target.kind === "update"
      ? target.currentPath || copy.placeholder
      : copy.placeholder;

  const selectedPath = selectedHostId
    ? browserDirectory
    : normalizeProjectPathInput(manualPath) || null;
  const derivedProjectName = selectedPath
    ? deriveProjectNameFromPath(selectedPath)
    : "";

  useEffect(() => {
    setValidationMessage(null);
  }, [selectedPath]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;

    if (!selectedPath) {
      setValidationMessage("Выберите папку проекта.");
      return;
    }

    const normalizedPath = normalizeProjectPathInput(selectedPath);
    const pathValidationMessage =
      getProjectPathValidationMessage(normalizedPath);
    if (pathValidationMessage) {
      setValidationMessage(pathValidationMessage);
      return;
    }

    if (
      target.kind === "create" &&
      !deriveProjectNameFromPath(normalizedPath)
    ) {
      setValidationMessage("Не удалось определить имя проекта по этому пути.");
      return;
    }

    void onSubmit(target, normalizedPath, selectedHostId);
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{getDialogTitle(target.kind)}</DialogTitle>
        <DialogDescription>
          {selectedHostId
            ? `Перейдите в папку проекта${
                selectedHostName ? ` на ${selectedHostName}` : ""
              }, или укажите путь вручную.`
            : noMachineAvailable
              ? "Нет машин в сети. Запустите одну, чтобы выбрать папку проекта."
              : copy.description}
        </DialogDescription>
      </DialogHeader>
      <form className="min-w-0 space-y-4" onSubmit={handleSubmit}>
        {showMachinePicker ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild disabled={pending}>
              <Button
                type="button"
                variant="outline"
                aria-label="Машина"
                disabled={pending}
                className="w-full justify-between font-normal"
              >
                <span className="flex min-w-0 items-center gap-2">
                  {selectedHost ? (
                    <MachineStatusDot connected={selectedHostConnected} />
                  ) : null}
                  <span className="min-w-0 truncate">
                    {selectedHost?.name ?? "Выберите машину"}
                  </span>
                </span>
                <Icon
                  name="ChevronDown"
                  className="size-4 shrink-0 text-muted-foreground"
                />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              mobileTitle="Машина"
              className="max-h-72 w-[var(--radix-dropdown-menu-trigger-width)] overflow-y-auto"
            >
              {machineOptions?.map((host) => {
                const connected = host.status === "connected";
                return (
                  <DropdownMenuItem
                    key={host.id}
                    disabled={!connected}
                    className="flex items-center gap-2"
                    onSelect={() => {
                      if (!connected) return;
                      setSelectedHostId(host.id);
                      setBrowserDirectory(null);
                    }}
                  >
                    <MachineStatusDot connected={connected} />
                    <span className="min-w-0 flex-1 truncate">{host.name}</span>
                    {!connected ? (
                      <span className="shrink-0 text-xs text-subtle-foreground">
                        Не в сети
                      </span>
                    ) : null}
                    <Icon
                      name="Check"
                      className={cn(
                        "size-4 shrink-0",
                        host.id === selectedHostId
                          ? "opacity-100"
                          : "opacity-0",
                      )}
                    />
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        {selectedHostId ? (
          <LazyRemotePathBrowser
            key={selectedHostId}
            hostId={selectedHostId}
            initialPath={target.kind === "update" ? target.currentPath : null}
            allowCreateFolder={target.kind === "create"}
            onDirectoryChange={setBrowserDirectory}
            disabled={pending || !selectedHostConnected}
          />
        ) : noMachineAvailable ? (
          <p className="rounded-md border px-3 py-6 text-center text-sm text-muted-foreground">
            Все машины не в сети. Подключите одну, чтобы просмотреть папки.
          </p>
        ) : (
          <Input
            id={inputId}
            aria-label="Путь к проекту"
            value={manualPath}
            autoFocus={!isPointerCoarse}
            disabled={pending}
            placeholder={placeholder}
            onChange={(event) => {
              setManualPath(event.target.value);
            }}
          />
        )}
        {(derivedProjectName && target.kind === "create") ||
        validationMessage ? (
          <div className="space-y-1">
            {target.kind === "create" && derivedProjectName ? (
              <p className="flex min-w-0 gap-1 text-sm text-muted-foreground">
                <span className="shrink-0">Имя проекта:</span>
                <span className="min-w-0 truncate font-medium text-foreground">
                  {derivedProjectName}
                </span>
              </p>
            ) : null}
            {validationMessage ? (
              <p className="text-sm text-destructive">{validationMessage}</p>
            ) : null}
          </div>
        ) : null}
        <DialogFooter>
          <Button
            type="submit"
            disabled={
              pending ||
              !selectedPath ||
              !selectedHostConnected ||
              noMachineAvailable
            }
          >
            {getDialogSubmitLabel(target.kind)}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
