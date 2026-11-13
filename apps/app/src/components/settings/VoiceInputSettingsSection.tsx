import { useState, type ReactNode } from "react";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { Popover, PopoverTrigger } from "@bb/shared-ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@bb/shared-ui/tooltip";
import {
  SettingsSection,
  SettingsWithControl,
} from "@/components/ui/settings-section";
import {
  useAudioInputDevices,
  type AudioInputDeviceOption,
} from "@/hooks/useAudioInputDevices";
import {
  useAudioInputDevicePreferenceValue,
  type PreferredAudioInputDeviceId,
} from "@/lib/audio-input-device-preference";
import { MicrophonePreferencesSplit } from "@/components/promptbox/MicrophonePreferencesSplit";
import { MicrophonePreferencesPopoverContent } from "@/components/promptbox/MicrophonePreferencesPopoverContent";
import { SETTINGS_DROPDOWN_TRIGGER_CLASS } from "./settings-dropdown";

interface VoiceInputSettingsSectionContentProps {
  devices: readonly AudioInputDeviceOption[];
  errorMessage: string | null;
  isLoading: boolean;
  isSupported: boolean;
  onRefresh: (requestPermission: boolean) => void;
  preferredDeviceId: PreferredAudioInputDeviceId;
}

const SYSTEM_DEFAULT_MICROPHONE_LABEL = "Системный по умолчанию";
const MICROPHONE_SETTING_LABEL = "Микрофон";

function selectedMicrophoneLabel({
  devices,
  isSupported,
  preferredDeviceId,
}: {
  devices: readonly AudioInputDeviceOption[];
  isSupported: boolean;
  preferredDeviceId: PreferredAudioInputDeviceId;
}): string {
  if (!isSupported) {
    return "Не поддерживается";
  }
  if (preferredDeviceId === null) {
    return SYSTEM_DEFAULT_MICROPHONE_LABEL;
  }
  return (
    devices.find((device) => device.deviceId === preferredDeviceId)?.label ??
    SYSTEM_DEFAULT_MICROPHONE_LABEL
  );
}

function microphoneSettingDescription({
  devices,
  errorMessage,
  isLoading,
  isSupported,
  preferredDeviceId,
  onRequestAccess,
}: {
  devices: readonly AudioInputDeviceOption[];
  onRequestAccess: () => void;
  errorMessage: string | null;
  isLoading: boolean;
  isSupported: boolean;
  preferredDeviceId: PreferredAudioInputDeviceId;
}): ReactNode {
  if (!isSupported) {
    return "Браузер не предоставляет доступ к микрофонам.";
  }
  if (isLoading) {
    return "Загрузка микрофонов.";
  }
  if (errorMessage !== null) {
    return errorMessage;
  }
  if (devices.length === 0) {
    return (
      <>
        <button
          type="button"
          className="rounded-sm underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          onClick={onRequestAccess}
        >
          Проверить доступ к микрофону
        </button>{" "}
        чтобы увидеть доступные устройства.
      </>
    );
  }
  if (
    preferredDeviceId !== null &&
    devices.every((device) => device.deviceId !== preferredDeviceId)
  ) {
    return "Предпочтительный микрофон отключён. До его подключения используется другой вход.";
  }
  return "Используется для голосового ввода запросов.";
}

export function VoiceInputSettingsSectionContent({
  devices,
  errorMessage,
  isLoading,
  isSupported,
  onRefresh,
  preferredDeviceId,
}: VoiceInputSettingsSectionContentProps) {
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const triggerLabel = selectedMicrophoneLabel({
    devices,
    isSupported,
    preferredDeviceId,
  });

  return (
    <SettingsSection
      title="Голосовой ввод"
      actionPlacement="inline"
      action={
        <Tooltip delayDuration={300} disableHoverableContent>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground hover:text-foreground"
              disabled={!isSupported || isLoading}
              onClick={() => onRefresh(true)}
              aria-label={
                isLoading ? "Загрузка микрофонов" : "Загрузить микрофоны"
              }
            >
              <Icon
                name="RotateCcw"
                className={cn("size-3.5", isLoading && "animate-spin")}
              />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Загрузить микрофоны</TooltipContent>
        </Tooltip>
      }
    >
      <SettingsWithControl
        label={MICROPHONE_SETTING_LABEL}
        description={microphoneSettingDescription({
          onRequestAccess: () => onRefresh(true),
          devices,
          errorMessage,
          isLoading,
          isSupported,
          preferredDeviceId,
        })}
      >
        <Popover
          open={preferencesOpen}
          onOpenChange={(open) => {
            setPreferencesOpen(open);
            onRefresh(false);
          }}
        >
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={SETTINGS_DROPDOWN_TRIGGER_CLASS}
              {...MicrophonePreferencesSplit.intentProps}
              aria-label={MICROPHONE_SETTING_LABEL}
              disabled={!isSupported}
            >
              <span className="flex min-w-0 items-center gap-2">
                <Icon name="Mic" className="size-3.5 shrink-0" />
                <span className="min-w-0 truncate">{triggerLabel}</span>
              </span>
              <Icon
                name="ChevronDown"
                className="size-3.5 text-muted-foreground"
              />
            </Button>
          </PopoverTrigger>
          <MicrophonePreferencesPopoverContent
            open={preferencesOpen}
            onClose={() => setPreferencesOpen(false)}
            warning={null}
            align="end"
            side="bottom"
          />
        </Popover>
      </SettingsWithControl>
    </SettingsSection>
  );
}

export function VoiceInputSettingsSection() {
  const preferredDeviceId = useAudioInputDevicePreferenceValue();
  const { devices, errorMessage, isLoading, isSupported, refresh } =
    useAudioInputDevices();

  return (
    <VoiceInputSettingsSectionContent
      devices={devices}
      errorMessage={errorMessage}
      isLoading={isLoading}
      isSupported={isSupported}
      onRefresh={(requestPermission) => {
        void refresh({ requestPermission });
      }}
      preferredDeviceId={preferredDeviceId}
    />
  );
}
