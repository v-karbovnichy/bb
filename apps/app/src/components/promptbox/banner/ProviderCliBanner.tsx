import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { ProviderRequirementBanner } from "./ProviderRequirementBanner";

interface ProviderCliBannerProps {
  displayName: string;
  installed: boolean;
  currentVersion: string | null;
  minimumSupportedVersion: string | null;
  canRunAction: boolean;
  actionRunning: boolean;
  onAction: () => void;
}

function versionRequirementCopy(
  currentVersion: string | null,
  minimumSupportedVersion: string | null,
): string {
  if (currentVersion !== null && minimumSupportedVersion !== null) {
    return `Установлена версия ${currentVersion}; требуется версия ${minimumSupportedVersion} или новее.`;
  }
  if (currentVersion !== null) {
    return `Установлена версия ${currentVersion}; требуется более новая версия.`;
  }
  if (minimumSupportedVersion !== null) {
    return `Требуется версия ${minimumSupportedVersion} или новее.`;
  }
  return "Требуется более новая версия.";
}

export function providerCliBlockedReason({
  displayName,
  installed,
}: {
  displayName: string;
  installed: boolean;
}): string {
  return `${installed ? "Обновите" : "Установите"} ${displayName}, прежде чем создавать чат.`;
}

export function ProviderCliBanner({
  displayName,
  installed,
  currentVersion,
  minimumSupportedVersion,
  canRunAction,
  actionRunning,
  onAction,
}: ProviderCliBannerProps) {
  const blockedReason = providerCliBlockedReason({ displayName, installed });
  return (
    <ProviderRequirementBanner
      title={
        installed
          ? `Требуется обновить ${displayName}`
          : `${displayName} не установлен`
      }
      description={
        installed ? (
          <>
            {blockedReason}{" "}
            {versionRequirementCopy(currentVersion, minimumSupportedVersion)}
          </>
        ) : (
          blockedReason
        )
      }
      action={
        canRunAction ? (
          <Button
            type="button"
            size="sm"
            className="h-8 shrink-0 px-3"
            disabled={actionRunning}
            onClick={onAction}
          >
            {actionRunning ? (
              <>
                <Icon name="Spinner" className="animate-spin" />
                {installed ? "Обновление…" : "Установка…"}
              </>
            ) : (
              `${installed ? "Обновить" : "Установить"} ${displayName}`
            )}
          </Button>
        ) : null
      }
    />
  );
}
