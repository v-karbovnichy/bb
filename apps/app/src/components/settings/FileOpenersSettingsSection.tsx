import { useMemo } from "react";
import { Button } from "@bb/shared-ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { Icon } from "@bb/shared-ui/icon";
import {
  SettingsSection,
  SettingsWithControl,
} from "@/components/ui/settings-section";
import { COARSE_POINTER_ICON_SIZE_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import {
  BUILT_IN_FILE_OPENER_PREFERENCE,
  buildFileOpenerRef,
  useFileOpenerPreference,
} from "@/lib/file-opener-preference";
import { usePluginSlots, type PluginFileOpenerSlot } from "@/lib/plugin-slots";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  SETTINGS_DROPDOWN_CONTENT_CLASS,
  SETTINGS_DROPDOWN_TRIGGER_CLASS,
} from "./settings-dropdown";

const AUTOMATIC_FILE_OPENER_PREFERENCE = "__automatic__";
const BUILTIN_LABEL = "Встроенный просмотр";

export function FileOpenersSettingsSection() {
  const { fileOpeners } = usePluginSlots();
  const [preference, setPreference] = useFileOpenerPreference();

  const extensions = useMemo(
    () =>
      [...new Set(fileOpeners.flatMap((opener) => opener.extensions))].sort(),
    [fileOpeners],
  );

  if (extensions.length === 0) return null;

  return (
    <SettingsSection
      title="Открытие файлов"
      description="Автоматически использовать подходящие плагины или выбрать просмотрщик для каждого типа файлов. Чтобы выбрать просмотрщик один раз, нажмите правой кнопкой мыши на ссылке файла."
    >
      <div className="space-y-5">
        {extensions.map((extension) => (
          <ExtensionOpenerControl
            key={extension}
            extension={extension}
            openers={fileOpeners.filter((opener) =>
              opener.extensions.includes(extension),
            )}
            preference={
              preference[extension] ?? AUTOMATIC_FILE_OPENER_PREFERENCE
            }
            onSelect={(selection) =>
              setPreference((previous) => {
                const next = { ...previous };
                if (selection === AUTOMATIC_FILE_OPENER_PREFERENCE) {
                  delete next[extension];
                } else {
                  next[extension] = selection;
                }
                return next;
              })
            }
          />
        ))}
      </div>
    </SettingsSection>
  );
}

function ExtensionOpenerControl({
  extension,
  onSelect,
  openers,
  preference,
}: {
  extension: string;
  onSelect: (selection: string) => void;
  openers: PluginFileOpenerSlot[];
  preference: string;
}) {
  const automaticOpener = openers[0];
  if (automaticOpener === undefined) return null;

  const options = [
    {
      key: AUTOMATIC_FILE_OPENER_PREFERENCE,
      label: `Автоматически (${automaticOpener.title})`,
    },
    { key: BUILT_IN_FILE_OPENER_PREFERENCE, label: BUILTIN_LABEL },
    ...openers.map((opener) => ({
      key: buildFileOpenerRef(opener),
      label: `${opener.title} (${opener.pluginId})`,
    })),
  ];
  const selected =
    options.find((option) => option.key === preference) ?? options[1];
  if (selected === undefined) return null;

  return (
    <SettingsWithControl label={`Файлы .${extension}`}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={SETTINGS_DROPDOWN_TRIGGER_CLASS}
            aria-label={`Приложение по умолчанию для файлов .${extension}`}
          >
            <span className="min-w-0 truncate">{selected.label}</span>
            <Icon
              name="ChevronDown"
              className="size-3.5 text-muted-foreground"
            />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className={SETTINGS_DROPDOWN_CONTENT_CLASS}
        >
          {options.map((option) => (
            <DropdownMenuItem
              key={option.key}
              onSelect={() => onSelect(option.key)}
            >
              <span className="min-w-0 truncate">{option.label}</span>
              <Icon
                name="Check"
                className={cn(
                  "ml-auto",
                  selected.key !== option.key && "opacity-0",
                  COARSE_POINTER_ICON_SIZE_CLASS,
                )}
              />
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </SettingsWithControl>
  );
}
