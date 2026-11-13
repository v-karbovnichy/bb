import { useMemo, useState } from "react";
import type { Host } from "@bb/domain";
import type { CliSkillMachineStatus } from "@bb/server-contract";
import { Button } from "@bb/shared-ui/button";
import { Checkbox } from "@bb/shared-ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import { MachineStatusDot } from "@/components/machines/MachineStatusDot";

interface InstallCliSkillsDialogContentProps {
  hosts: readonly Host[];
  onCancel: () => void;
  onInstall: (hostIds: string[]) => void;
  pending: boolean;
  statusByHostId: ReadonlyMap<string, CliSkillMachineStatus>;
}

const MACHINE_STATUS_LABELS: Record<CliSkillMachineStatus, string | null> = {
  installed: "Установлено",
  outdated: "Устарели",
  missing: "Не установлены",
  unknown: null,
};

function isConnected(host: Host): boolean {
  return host.status === "connected";
}

function machineStatusLabel(args: {
  connected: boolean;
  status: CliSkillMachineStatus | undefined;
}): string | null {
  if (!args.connected) return "Не подключена";
  return args.status === undefined ? null : MACHINE_STATUS_LABELS[args.status];
}

function InstallCliSkillsDialogContent({
  hosts,
  onCancel,
  onInstall,
  pending,
  statusByHostId,
}: InstallCliSkillsDialogContentProps) {
  const connectedHostIds = useMemo(
    () => hosts.filter(isConnected).map((host) => host.id),
    [hosts],
  );
  const [selectedHostIds, setSelectedHostIds] =
    useState<readonly string[]>(connectedHostIds);
  const choosable = hosts.length > 1;
  const selected = choosable
    ? selectedHostIds.filter((hostId) => connectedHostIds.includes(hostId))
    : connectedHostIds;

  return (
    <>
      <DialogHeader>
        <DialogTitle>Установить навыки CLI bb</DialogTitle>
        <DialogDescription>
          {choosable
            ? "Выберите машины для установки. На каждой навыки будут установлены в ~/.agents/skills и ~/.claude/skills, заменив существующие копии."
            : `Навыки будут установлены в ~/.agents/skills и ~/.claude/skills на ${hosts[0]?.name ?? "выбранной машине"} с заменой существующих копий.`}
        </DialogDescription>
      </DialogHeader>

      {choosable ? (
        <div className="flex flex-col gap-1 py-1">
          {hosts.map((host) => {
            const connected = isConnected(host);
            const statusLabel = machineStatusLabel({
              connected,
              status: statusByHostId.get(host.id),
            });
            return (
              <label
                key={host.id}
                className="flex items-center gap-2.5 rounded-md px-1 py-2 text-sm has-[:disabled]:opacity-60"
              >
                <Checkbox
                  checked={selected.includes(host.id)}
                  disabled={!connected || pending}
                  onCheckedChange={(checked) =>
                    setSelectedHostIds((current) =>
                      checked === true
                        ? [...current, host.id]
                        : current.filter((hostId) => hostId !== host.id),
                    )
                  }
                  aria-label={host.name}
                />
                <MachineStatusDot connected={connected} />
                <span className="min-w-0 truncate">{host.name}</span>
                {statusLabel === null ? null : (
                  <span className="ml-auto shrink-0 text-xs text-subtle-foreground">
                    {statusLabel}
                  </span>
                )}
              </label>
            );
          })}
        </div>
      ) : null}

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          type="button"
          disabled={pending || selected.length === 0}
          onClick={() => onInstall([...selected])}
        >
          {pending ? "Установка…" : "Установить"}
        </Button>
      </DialogFooter>
    </>
  );
}

interface InstallCliSkillsDialogProps extends InstallCliSkillsDialogContentProps {
  onOpenChange: (open: boolean) => void;
  open: boolean;
}

export function InstallCliSkillsDialog({
  onOpenChange,
  open,
  ...contentProps
}: InstallCliSkillsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {open ? <InstallCliSkillsDialogContent {...contentProps} /> : null}
      </DialogContent>
    </Dialog>
  );
}
