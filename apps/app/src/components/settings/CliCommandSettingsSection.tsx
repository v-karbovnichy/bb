import type { SystemCliCommandStatus } from "@bb/server-contract";
import { Button } from "@bb/shared-ui/button";
import {
  SettingsSection,
  SettingsWithControl,
} from "@/components/ui/settings-section";
import { useChangeCliCommand } from "@/hooks/mutations/settings-mutations";
import { useCliCommandStatus } from "@/hooks/queries/system-queries";

const CLI_COMMAND_SETTING_LABEL = "bb CLI";

interface CliCommandSettingsSectionContentProps {
  onChange: (change: "install" | "remove") => void;
  pending: boolean;
  status: SystemCliCommandStatus;
}

export function describeCliCommandStatus(
  status: SystemCliCommandStatus,
): string {
  if (status.installedPath !== null) {
    return status.onPath
      ? `Установлено в ${status.installedPath}. Управлять bb можно из любого терминала; агенты вне bb, например Claude Code или Codex, тоже смогут им пользоваться.`
      : `Установлено в ${status.installedPath}, но эта папка не входит в PATH. Добавьте её в PATH, чтобы пользоваться bb вне bb.`;
  }
  if (status.shadowedBy === null) {
    return "Установите CLI bb для работы вне bb. Управлять bb можно из любого терминала; агенты вне bb, например Claude Code или Codex, тоже смогут им пользоваться. В чатах bb CLI уже доступен.";
  }
  if (status.shadowedBy.source === "npm") {
    return `Уже установлено для работы вне bb через npm по пути ${status.shadowedBy.path}.`;
  }
  if (status.shadowedBy.source === "machine") {
    return `Уже установлено для работы вне bb вместе с машиной bb на этом компьютере: ${status.shadowedBy.path}.`;
  }
  return `В PATH раньше находится другая установка bb: ${status.shadowedBy.path}. Удалите её, чтобы установить эту версию.`;
}

export function CliCommandSettingsSectionContent({
  onChange,
  pending,
  status,
}: CliCommandSettingsSectionContentProps) {
  const installed = status.installedPath !== null;
  return (
    <SettingsSection title="Командная строка">
      <SettingsWithControl
        controlPlacement="trailing"
        label={CLI_COMMAND_SETTING_LABEL}
        {...(installed ? { labelBadge: "Установлено" } : {})}
        description={describeCliCommandStatus(status)}
      >
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending || (!installed && status.shadowedBy !== null)}
          onClick={() => onChange(installed ? "remove" : "install")}
          aria-label={`${installed ? "Удалить" : "Установить"} ${CLI_COMMAND_SETTING_LABEL}`}
        >
          {installed ? "Удалить" : "Установить"}
        </Button>
      </SettingsWithControl>
    </SettingsSection>
  );
}

export function CliCommandSettingsSection() {
  const statusQuery = useCliCommandStatus();
  const changeCliCommand = useChangeCliCommand();
  const status = statusQuery.data;
  if (status === undefined || !status.supported) {
    return null;
  }

  return (
    <CliCommandSettingsSectionContent
      status={status}
      pending={changeCliCommand.isPending || statusQuery.isRefetching}
      onChange={(change) =>
        changeCliCommand.mutate(change, {
          onSettled: () => {
            void statusQuery.refetch();
          },
        })
      }
    />
  );
}
