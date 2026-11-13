import { ApplicationLinkApprovalsSettings } from "@/components/settings/ApplicationLinkApprovalsSettings";
import { MobileAppSection } from "@/components/settings/MobileAppSection";
import { MachineEnvironmentSettings } from "@/components/settings/MachineEnvironmentSettings";
import { MachineAccessSettings } from "@/components/settings/MachineAccessSettings";
import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  Navigate,
  useNavigate,
  useLocation,
  matchPath,
} from "react-router-dom";
import "@bb/shared-ui/icon-extended";
import {
  builtInThemes,
  defaultAppSettings,
  defaultAppTheme,
  defaultExperiments,
  earlyAdopterExperiments,
  experimentKeys,
  managedBranchPrefixSchema,
  type AppTheme,
  type ExperimentKey,
  type Experiments,
  type FaviconColorPreference,
  type PluginThemeMeta,
} from "@bb/domain";
import type {
  WorkspaceOpenTarget,
  WorkspaceOpenTargetId,
} from "@bb/host-daemon-contract";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { Input } from "@bb/shared-ui/input";
import { Switch } from "@bb/shared-ui/switch";
import { COARSE_POINTER_ICON_SIZE_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { PageShell } from "@/components/ui/page-shell.js";
import {
  SettingsSection,
  SettingsWithControl,
} from "@/components/ui/settings-section.js";
import { WorkspaceOpenTargetIcon } from "@/components/workspace-open-target/WorkspaceOpenTargetIcon";
import {
  setPreferredTheme,
  useThemePreference,
  type ThemePreference,
} from "@/hooks/useTheme";
import { useHostDaemon, useLocalHostDaemonAccess } from "@/hooks/useHostDaemon";
import { useAppThemePreview } from "@/hooks/useAppThemePreview";
import { ProvidersSettingsSection } from "@/components/settings/ProvidersSettingsSection";
import { CodeRendererSettings } from "@/components/settings/CodeRendererSettings";
import { SidebarThreadListSetting } from "@/components/settings/SidebarThreadListSetting";
import { SidebarNavigationProviderSetting } from "@/components/settings/SidebarNavigationProviderSetting";
import { SidebarFooterSettings } from "@/components/settings/SidebarFooterSettings";
import { SplitDimmingSetting } from "@/components/settings/SplitDimmingSetting";
import { useSettingsNavState } from "@/components/settings/settings-nav";
import { useRevealSettingsSearchTarget } from "@/components/settings/useRevealSettingsSearchTarget";
import { PluginsOverview } from "@/components/plugin/PluginsOverview";
import { PluginDetailPaneView } from "@/views/ToolsView";
import { SETTINGS_PLUGIN_ROUTE_PATH } from "@/lib/route-paths";
import { PluginSettingsPage } from "@/components/plugin/PluginSettings";
import { FileOpenersSettingsSection } from "@/components/settings/FileOpenersSettingsSection";
import { VoiceInputSettingsSection } from "@/components/settings/VoiceInputSettingsSection";
import { AiServicesSettingsSection } from "@/components/settings/AiServicesSettingsSection";
import { CommunitySettingsSection } from "@/components/settings/CommunitySettingsSection";
import { UpdatesSettingsSection } from "@/components/settings/UpdatesSettingsSection";
import { KeyboardSettingsSection } from "@/components/settings/KeyboardSettingsSection";
import { BrowserSettingsSection } from "@/components/settings/BrowserSettingsSection";
import { MachinesSettingsSection } from "@/components/settings/MachinesSettingsSection";
import { ProjectsSettingsSection } from "@/components/settings/ProjectsSettingsSection";
import { ArchivedThreadsSettingsSection } from "@/components/settings/ArchivedThreadsSettingsSection";
import { CliCommandSettingsSection } from "@/components/settings/CliCommandSettingsSection";
import { CliSkillsSettingsSection } from "@/components/settings/CliSkillsSettingsSection";
import { MarketplacesSettingsSection } from "@/components/settings/MarketplacesSettingsSection";
import {
  useUpdateGeneralSettings,
  useUpdateAppearance,
  useUpdateExperiments,
} from "@/hooks/mutations/settings-mutations";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import { useWorkspaceOpenTargets } from "@/hooks/useWorkspaceOpenTargets";
import { isDesktopBrowserAvailable } from "@/lib/bb-desktop";
import { showMutationErrorToast } from "@/lib/mutation-errors";
import {
  FAVICON_COLOR_VALUES,
  getFaviconGlyphHref,
} from "@/lib/favicon-color-preference";
import { useOpenLinksInAppBrowserPreference } from "@/lib/in-app-browser-link-preference";
import { useRewriteLocalhostLinksPreference } from "@/lib/localhost-link-rewrite-preference";
import { localhostLinkRewriteDescription } from "@/lib/localhost-link-rewrite-description";
import {
  SETTINGS_ROUTE_PATH,
  getRootComposeRoutePath,
} from "@/lib/route-paths";
import { useNavigateToThreadAfterCreatePreference } from "@/lib/root-compose-create-preference";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  resolvePreferredWorkspaceOpenTarget,
  supportsWorkspaceOpenTargetCapability,
  useFileOpenTargetPreference,
  useWorkspaceOpenTargetPreference,
  type StoredWorkspaceOpenTargetPreference,
  type WorkspaceOpenTargetCapability,
} from "@/lib/workspace-open-target-preference";
import { getWorkspaceOpenTargetFallbackLabel } from "@/components/workspace-open-target/workspace-open-target-display";
import type { LocalHostDaemonAccessState } from "@/lib/local-host-daemon-access";
import { openUrlInExternalBrowser } from "@/lib/url-open-routing";

const LOCAL_EDITOR_INTEGRATION_DOCS_URL =
  "https://github.com/get-bb/bb/blob/main/docs/multiple-devices.md#open-bb-from-another-browser";

interface ThemePreferenceOption {
  label: string;
  value: ThemePreference;
}

interface FaviconColorOption {
  label: string;
  value: FaviconColorPreference;
}

interface LocalOpenTargetPreferenceDefinition {
  capability: WorkspaceOpenTargetCapability;
  emptyDescription: string;
  label: string;
}

interface LocalOpenTargetPreferenceControlProps {
  definition: LocalOpenTargetPreferenceDefinition;
  onTargetChange: (targetId: WorkspaceOpenTargetId) => void;
  preferredTargetId: StoredWorkspaceOpenTargetPreference;
  targets: WorkspaceOpenTarget[];
}

export interface LocalOpenTargetSettingsSectionProps {
  accessState: LocalHostDaemonAccessState;
  directoryTargetId: StoredWorkspaceOpenTargetPreference;
  fileTargetId: StoredWorkspaceOpenTargetPreference;
  hasDaemon: boolean;
  onDirectoryTargetChange: (targetId: WorkspaceOpenTargetId) => void;
  onFileTargetChange: (targetId: WorkspaceOpenTargetId) => void;
  onRequestAccess: () => Promise<boolean>;
  targets: WorkspaceOpenTarget[];
}

interface FaviconColorSettingsControlProps {
  disabled: boolean;
  faviconColor: FaviconColorPreference;
  onFaviconColorChange: (faviconColor: FaviconColorPreference) => void;
}

interface AppearanceSettingsSectionProps {
  appearance: AppTheme;
  appearanceDisabled: boolean;
  customThemes: readonly string[];
  pluginThemes: readonly PluginThemeMeta[];
  faviconColor: FaviconColorPreference;
  onAppearanceThemeChange: (themeId: string) => void;
  onAppearanceThemePrefetch: (themeIds: readonly string[]) => void;
  onAppearanceThemePreview: (themeId: string | null) => void;
  onCreatePalette: () => void;
  onFaviconColorChange: (faviconColor: FaviconColorPreference) => void;
  onThemePreferenceChange: (themePreference: ThemePreference) => void;
  themePreference: ThemePreference;
}

interface GeneralSettingsSectionProps {
  confirmThreadArchive: boolean;
  onConfirmThreadArchiveChange: (enabled: boolean) => void;
  keepHistoryAfterContextClear: boolean;
  onKeepHistoryAfterContextClearChange: (enabled: boolean) => void;
  summarizeShellCommands: boolean;
  onSummarizeShellCommandsChange: (enabled: boolean) => void;
  desktopBrowserAvailable: boolean;
  generalSettingsDisabled: boolean;
  managedBranchPrefix: string;
  navigateToThreadAfterCreate: boolean;
  onManagedBranchPrefixChange: (prefix: string) => Promise<void> | void;
  onNavigateToThreadAfterCreateChange: (enabled: boolean) => void;
  onOpenLinksInAppBrowserChange: (enabled: boolean) => void;
  onReplaySetupGuide: () => void;
  onRewriteLocalhostLinksChange: (enabled: boolean) => void;
  onSteerActiveThreadOnEnterChange: (enabled: boolean) => void;
  onTerminalCopyOnSelectChange: (enabled: boolean) => void;
  terminalCopyOnSelect: boolean;
  openLinksInAppBrowser: boolean;
  rewriteLocalhostLinks: boolean;
  steerActiveThreadOnEnter: boolean;
}

interface PrivacySettingsSectionProps {
  onStreamerModeChange: (enabled: boolean) => void;
  streamerMode: boolean;
  telemetryEnabled: boolean;
  onTelemetryEnabledChange: (enabled: boolean) => void;
  disabled: boolean;
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
}

function appPaletteLabel(
  appearance: AppTheme,
  pluginThemes: readonly PluginThemeMeta[],
): string {
  const meta = builtInThemes.find((entry) => entry.id === appearance.themeId);
  return (
    meta?.name ??
    pluginThemes.find((entry) => entry.id === appearance.themeId)?.name ??
    appearance.themeId
  );
}

interface ExperimentsSettingsSectionProps {
  performanceDiagnosticsAvailable: boolean;
  disabled: boolean;
  earlyAdopter: boolean;
  onEarlyAdopterChange: (enabled: boolean) => void;
  experiments: Experiments;
  onExperimentChange: (key: ExperimentKey, enabled: boolean) => void;
}

const THEME_PREFERENCE_OPTIONS: ReadonlyArray<ThemePreferenceOption> = [
  { label: "Системная", value: "system" },
  { label: "Светлая", value: "light" },
  { label: "Тёмная", value: "dark" },
];

const THEME_PREFERENCE_LABELS: Record<ThemePreference, string> = {
  dark: "Тёмная",
  light: "Светлая",
  system: "Системная",
};

const FAVICON_COLOR_OPTIONS: ReadonlyArray<FaviconColorOption> = [
  { label: "По умолчанию", value: "default" },
  { label: "Красный", value: "red" },
  { label: "Оранжевый", value: "orange" },
  { label: "Жёлтый", value: "yellow" },
  { label: "Зелёный", value: "green" },
  { label: "Бирюзовый", value: "teal" },
  { label: "Синий", value: "blue" },
  { label: "Фиолетовый", value: "purple" },
  { label: "Розовый", value: "pink" },
];

const FAVICON_COLOR_LABELS: Record<FaviconColorPreference, string> = {
  blue: "Синий",
  default: "По умолчанию",
  green: "Зелёный",
  orange: "Оранжевый",
  pink: "Розовый",
  purple: "Фиолетовый",
  red: "Красный",
  teal: "Бирюзовый",
  yellow: "Жёлтый",
};

const SETTINGS_DROPDOWN_TRIGGER_CLASS =
  "h-7 w-full justify-between border-border/60 bg-card px-2 text-xs @min-[36rem]/settings:w-36";
const SETTINGS_DROPDOWN_CONTENT_CLASS =
  "min-w-[var(--radix-dropdown-menu-trigger-width)]";

const CREATE_CUSTOM_PALETTE_PROMPT =
  "Create a custom bb palette. First run `bb theme dir` to find the custom theme directory. Ask me for the palette name and visual direction, then create `<theme-dir>/<name>/theme.css` with light and dark theme variables compatible with bb's theme tokens.";
const PALETTE_SETTING_DESCRIPTION =
  "Палитры меняют цвета bb, включая подсветку синтаксиса в изменениях и предпросмотре файлов. Выберите встроенную палитру или создайте новую по запросу.";

interface PaletteMenuItemProps {
  active: boolean;
  children: ReactNode;
  onPreview: (themeId: string | null) => void;
  onSelect: (themeId: string) => void;
  themeId: string;
}

function PaletteMenuItem({
  active,
  children,
  onPreview,
  onSelect,
  themeId,
}: PaletteMenuItemProps) {
  return (
    <DropdownMenuItem
      onFocus={() => onPreview(themeId)}
      onBlur={() => onPreview(null)}
      onSelect={() => onSelect(themeId)}
    >
      {children}
      <Icon
        name="Check"
        className={cn(
          "ml-auto",
          !active && "opacity-0",
          COARSE_POINTER_ICON_SIZE_CLASS,
        )}
      />
    </DropdownMenuItem>
  );
}

function FaviconColorPreview({ value }: { value: FaviconColorPreference }) {
  return (
    <span
      aria-hidden
      className={cn("size-4 shrink-0", value === "default" && "bg-foreground")}
      style={{
        mask: `url("${getFaviconGlyphHref()}") center / contain no-repeat`,
        ...(value === "default"
          ? undefined
          : { backgroundColor: FAVICON_COLOR_VALUES[value] }),
      }}
    />
  );
}

function FaviconColorSettingsControl({
  disabled,
  faviconColor,
  onFaviconColorChange,
}: FaviconColorSettingsControlProps) {
  return (
    <SettingsWithControl
      label="Цвет значка вкладки"
      description="Окрасьте вкладки браузера, чтобы различать экземпляры приложения."
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={SETTINGS_DROPDOWN_TRIGGER_CLASS}
            aria-label="Цвет значка вкладки"
            disabled={disabled}
          >
            <span className="flex min-w-0 items-center gap-2">
              <FaviconColorPreview value={faviconColor} />
              <span className="min-w-0 truncate">
                {FAVICON_COLOR_LABELS[faviconColor]}
              </span>
            </span>
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
          {FAVICON_COLOR_OPTIONS.map((option) => (
            <DropdownMenuItem
              key={option.value}
              onSelect={() => onFaviconColorChange(option.value)}
            >
              <FaviconColorPreview value={option.value} />
              {option.label}
              <Icon
                name="Check"
                className={cn(
                  "ml-auto",
                  faviconColor !== option.value && "opacity-0",
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

const DIRECTORY_TARGET_PREFERENCE: LocalOpenTargetPreferenceDefinition = {
  capability: "openDirectory",
  emptyDescription: "Нет локальных приложений для открытия папок.",
  label: "Приложение для папок по умолчанию",
};

const FILE_TARGET_PREFERENCE: LocalOpenTargetPreferenceDefinition = {
  capability: "openFile",
  emptyDescription: "Нет локальных приложений для открытия файлов.",
  label: "Приложение для файлов по умолчанию",
};

function LocalOpenTargetPreferenceControl({
  definition,
  onTargetChange,
  preferredTargetId,
  targets,
}: LocalOpenTargetPreferenceControlProps) {
  const compatibleTargets = useMemo(
    () =>
      targets.filter((target) =>
        supportsWorkspaceOpenTargetCapability({
          capability: definition.capability,
          target,
        }),
      ),
    [definition.capability, targets],
  );
  const resolvedTarget = useMemo(
    () =>
      resolvePreferredWorkspaceOpenTarget({
        capability: definition.capability,
        preferredTargetId,
        targets,
      }),
    [definition.capability, preferredTargetId, targets],
  );
  const unavailableMessage =
    compatibleTargets.length === 0 ? definition.emptyDescription : null;
  const selectedTargetId = resolvedTarget?.id ?? preferredTargetId;
  const buttonLabel =
    resolvedTarget?.label ??
    (preferredTargetId
      ? getWorkspaceOpenTargetFallbackLabel(preferredTargetId)
      : "Недоступно");

  return (
    <SettingsWithControl label={definition.label}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={SETTINGS_DROPDOWN_TRIGGER_CLASS}
            aria-label={definition.label}
          >
            <span className="flex min-w-0 items-center gap-2">
              {selectedTargetId ? (
                <WorkspaceOpenTargetIcon
                  {...(resolvedTarget
                    ? { target: resolvedTarget }
                    : { targetId: selectedTargetId })}
                  className="size-5"
                />
              ) : null}
              <span className="min-w-0 truncate">{buttonLabel}</span>
            </span>
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
          {unavailableMessage ? (
            <div
              role="note"
              className="px-2 py-[0.3125rem] text-xs leading-snug text-foreground"
            >
              {unavailableMessage}
            </div>
          ) : (
            compatibleTargets.map((target) => (
              <DropdownMenuItem
                key={target.id}
                onSelect={() => onTargetChange(target.id)}
              >
                <WorkspaceOpenTargetIcon target={target} className="size-5" />
                <span className="min-w-0 truncate">{target.label}</span>
                <Icon
                  name="Check"
                  className={cn(
                    "ml-auto",
                    resolvedTarget?.id !== target.id && "opacity-0",
                    COARSE_POINTER_ICON_SIZE_CLASS,
                  )}
                />
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </SettingsWithControl>
  );
}

export function LocalOpenTargetSettingsSection({
  accessState,
  directoryTargetId,
  fileTargetId,
  hasDaemon,
  onDirectoryTargetChange,
  onFileTargetChange,
  onRequestAccess,
  targets,
}: LocalOpenTargetSettingsSectionProps) {
  const [accessRequestPending, setAccessRequestPending] = useState(false);

  if (accessState === "unavailable") {
    return null;
  }

  const handleRequestAccess = async () => {
    setAccessRequestPending(true);
    try {
      await onRequestAccess();
    } catch (error) {
      showMutationErrorToast({
        error,
        fallbackMessage: "Не удалось подключиться к bb на этом устройстве",
      });
    } finally {
      setAccessRequestPending(false);
    }
  };

  if (!hasDaemon) {
    const accessDenied = accessState === "denied";
    const accessAvailable = accessState === "available";
    const descriptionText = accessDenied
      ? "Браузер заблокировал доступ к bb на этом устройстве. Разрешите сайту доступ к локальной сети в настройках браузера и перезагрузите bb."
      : accessAvailable
        ? "bb не удалось подключиться к локальному помощнику редактора. Убедитесь, что приложение bb или CLI запущены на этом устройстве, затем повторите попытку. Если они уже запущены, возможно, нужно настроить удалённый адрес браузера."
        : "Подключите браузер к bb на этом устройстве, чтобы найти установленные редакторы. bb свяжется с локальным помощником только после нажатия «Включить». Браузер может запросить доступ к локальной сети.";
    const buttonLabel = accessRequestPending
      ? accessAvailable
        ? "Повторная попытка…"
        : "Включение…"
      : accessDenied
        ? "Заблокировано"
        : accessAvailable
          ? "Повторить"
          : "Включить";

    return (
      <SettingsSection title="Настройки файлов">
        <SettingsWithControl
          label="Интеграция с локальным редактором"
          description={
            <>
              {descriptionText}{" "}
              <a
                href={LOCAL_EDITOR_INTEGRATION_DOCS_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-0.5 rounded-sm underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                onClick={(event) => {
                  event.preventDefault();
                  openUrlInExternalBrowser(LOCAL_EDITOR_INTEGRATION_DOCS_URL);
                }}
              >
                Руководство по настройке
                <Icon
                  name="ExternalLink"
                  className="size-3 shrink-0"
                  aria-hidden
                />
              </a>
            </>
          }
        >
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={accessRequestPending || accessDenied}
            onClick={() => void handleRequestAccess()}
          >
            {buttonLabel}
          </Button>
        </SettingsWithControl>
      </SettingsSection>
    );
  }

  return (
    <SettingsSection title="Настройки файлов">
      <div className="space-y-5">
        <LocalOpenTargetPreferenceControl
          definition={DIRECTORY_TARGET_PREFERENCE}
          onTargetChange={onDirectoryTargetChange}
          preferredTargetId={directoryTargetId}
          targets={targets}
        />
        <LocalOpenTargetPreferenceControl
          definition={FILE_TARGET_PREFERENCE}
          onTargetChange={onFileTargetChange}
          preferredTargetId={fileTargetId}
          targets={targets}
        />
      </div>
    </SettingsSection>
  );
}

const IN_APP_BROWSER_LINK_SETTING_LABEL = "Открывать ссылки во встроенном браузере";
const REWRITE_LOCALHOST_LINKS_SETTING_LABEL = "Преобразовывать ссылки localhost";
const NAVIGATE_TO_THREAD_AFTER_CREATE_SETTING_LABEL =
  "Переходить к новым чатам";
const DIAGNOSTIC_EVENTS_SETTING_LABEL = "Показывать диагностические события";
const FOLLOW_UP_BEHAVIOR_SETTING_LABEL = "Действие Enter в работающем чате";
const FOLLOW_UP_BEHAVIOR_OPTIONS = [
  {
    steerOnEnter: false,
    label: "В очередь",
    description:
      "Enter добавляет следующее сообщение в очередь. Оно отправится, когда агент остановится. Command+Enter (Ctrl+Enter в Windows и Linux) направляет текущий запуск.",
  },
  {
    steerOnEnter: true,
    label: "Направить",
    description:
      "Enter направляет текущий запуск. Command+Enter (Ctrl+Enter в Windows и Linux) добавляет следующее сообщение в очередь.",
  },
] as const;
const STREAMER_MODE_SETTING_LABEL = "Режим трансляции";
const MANAGED_BRANCH_PREFIX_SETTING_LABEL = "Префикс новой ветки";
const MANAGED_BRANCH_PREFIX_EXAMPLE_SLUG = "fix-login-flow-thr_ab12cd34ef";

interface ManagedBranchPrefixSettingProps {
  disabled: boolean;
  onChange: (prefix: string) => Promise<void> | void;
  value: string;
}

function ManagedBranchPrefixSetting({
  disabled,
  onChange,
  value,
}: ManagedBranchPrefixSettingProps) {
  const [draft, setDraft] = useState(value);
  const [committedValue, setCommittedValue] = useState(value);
  if (value !== committedValue) {
    setCommittedValue(value);
    setDraft(value);
  }

  const valid = managedBranchPrefixSchema.safeParse(draft).success;
  const commit = () => {
    if (!valid) {
      setDraft(value);
      return;
    }
    if (draft !== value) {
      void Promise.resolve(onChange(draft)).catch(() => setDraft(value));
    }
  };

  return (
    <SettingsWithControl
      label={MANAGED_BRANCH_PREFIX_SETTING_LABEL}
      description={
        valid ? (
          `bb добавляет этот префикс к каждой ветке, создаваемой для рабочей копии, например ${draft}${MANAGED_BRANCH_PREFIX_EXAMPLE_SLUG}. Оставьте поле пустым, чтобы не использовать префикс.`
        ) : (
          <span className="text-destructive" role="alert">
            С этим префиксом нельзя создать допустимое имя ветки Git.
          </span>
        )
      }
      controlPlacement="below"
    >
      <Input
        value={draft}
        aria-label={MANAGED_BRANCH_PREFIX_SETTING_LABEL}
        aria-invalid={!valid}
        disabled={disabled}
        placeholder="Без префикса"
        className={cn(
          "h-8 font-mono text-xs",
          !valid && "border-destructive focus-visible:ring-destructive",
        )}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            setDraft(value);
          }
        }}
      />
    </SettingsWithControl>
  );
}

export function AppearanceSettingsSection({
  appearance,
  appearanceDisabled,
  customThemes,
  pluginThemes,
  faviconColor,
  onAppearanceThemeChange,
  onAppearanceThemePrefetch,
  onAppearanceThemePreview,
  onFaviconColorChange,
  onCreatePalette,
  onThemePreferenceChange,
  themePreference,
}: AppearanceSettingsSectionProps) {
  const paletteSelectedRef = useRef(false);
  const previewPalette = (themeId: string | null) => {
    if (themeId === null && paletteSelectedRef.current) return;
    onAppearanceThemePreview(themeId);
  };
  const selectPalette = (themeId: string) => {
    paletteSelectedRef.current = true;
    onAppearanceThemeChange(themeId);
  };
  return (
    <div className="space-y-6">
      <SettingsSection title="Внешний вид">
        <div className="space-y-5">
          <SettingsWithControl label="Тема">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className={SETTINGS_DROPDOWN_TRIGGER_CLASS}
                  aria-label="Тема"
                >
                  {THEME_PREFERENCE_LABELS[themePreference]}
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
                {THEME_PREFERENCE_OPTIONS.map((option) => (
                  <DropdownMenuItem
                    key={option.value}
                    onSelect={() => onThemePreferenceChange(option.value)}
                  >
                    {option.label}
                    <Icon
                      name="Check"
                      className={cn(
                        "ml-auto",
                        themePreference !== option.value && "opacity-0",
                        COARSE_POINTER_ICON_SIZE_CLASS,
                      )}
                    />
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </SettingsWithControl>

          <SettingsWithControl
            label="Палитра"
            description={PALETTE_SETTING_DESCRIPTION}
          >
            <DropdownMenu
              onOpenChange={(open) => {
                if (open) {
                  paletteSelectedRef.current = false;
                  onAppearanceThemePrefetch([
                    ...builtInThemes.map((entry) => entry.id),
                    ...customThemes,
                    ...pluginThemes.map((theme) => theme.id),
                  ]);
                  return;
                }
                previewPalette(null);
              }}
            >
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className={SETTINGS_DROPDOWN_TRIGGER_CLASS}
                  aria-label="Палитра"
                  disabled={appearanceDisabled}
                >
                  <span className="min-w-0 truncate">
                    {appPaletteLabel(appearance, pluginThemes)}
                  </span>
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
                {builtInThemes.map((entry) => (
                  <PaletteMenuItem
                    key={entry.id}
                    themeId={entry.id}
                    active={appearance.themeId === entry.id}
                    onPreview={previewPalette}
                    onSelect={selectPalette}
                  >
                    {entry.name}
                  </PaletteMenuItem>
                ))}
                {customThemes.map((name) => (
                  <PaletteMenuItem
                    key={`custom:${name}`}
                    themeId={name}
                    active={appearance.themeId === name}
                    onPreview={previewPalette}
                    onSelect={selectPalette}
                  >
                    {name}
                  </PaletteMenuItem>
                ))}
                {pluginThemes.map((theme) => (
                  <PaletteMenuItem
                    key={theme.id}
                    themeId={theme.id}
                    active={appearance.themeId === theme.id}
                    onPreview={previewPalette}
                    onSelect={selectPalette}
                  >
                    {theme.name}
                    <span className="text-muted-foreground">
                      ({theme.pluginId})
                    </span>
                  </PaletteMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={onCreatePalette}>
                  <Icon
                    name="Plus"
                    className={COARSE_POINTER_ICON_SIZE_CLASS}
                  />
                  Создать
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SettingsWithControl>

          <FaviconColorSettingsControl
            disabled={appearanceDisabled}
            faviconColor={faviconColor}
            onFaviconColorChange={onFaviconColorChange}
          />
          <SplitDimmingSetting />
        </div>
      </SettingsSection>
      <SettingsSection title="Интерфейс">
        <div className="space-y-5">
          <SidebarNavigationProviderSetting />
          <SidebarThreadListSetting />
          <CodeRendererSettings />
          <SidebarFooterSettings />
        </div>
      </SettingsSection>
    </div>
  );
}

export function GeneralSettingsSection({
  confirmThreadArchive,
  onConfirmThreadArchiveChange,
  keepHistoryAfterContextClear,
  onKeepHistoryAfterContextClearChange,
  summarizeShellCommands,
  onSummarizeShellCommandsChange,
  desktopBrowserAvailable,
  generalSettingsDisabled,
  managedBranchPrefix,
  navigateToThreadAfterCreate,
  onManagedBranchPrefixChange,
  onNavigateToThreadAfterCreateChange,
  onOpenLinksInAppBrowserChange,
  onReplaySetupGuide,
  onRewriteLocalhostLinksChange,
  onSteerActiveThreadOnEnterChange,
  onTerminalCopyOnSelectChange,
  terminalCopyOnSelect,
  openLinksInAppBrowser,
  rewriteLocalhostLinks,
  steerActiveThreadOnEnter,
}: GeneralSettingsSectionProps) {
  const localhostRewriteDescription = localhostLinkRewriteDescription(
    typeof window === "undefined" ? undefined : window.location.hostname,
  );
  return (
    <>
      <SettingsSection title="Чаты и редактирование">
        <div className="space-y-5">
          <SettingsWithControl
            label={NAVIGATE_TO_THREAD_AFTER_CREATE_SETTING_LABEL}
          >
            <Switch
              checked={navigateToThreadAfterCreate}
              onCheckedChange={onNavigateToThreadAfterCreateChange}
              aria-label={NAVIGATE_TO_THREAD_AFTER_CREATE_SETTING_LABEL}
            />
          </SettingsWithControl>

          <SettingsWithControl
            label={FOLLOW_UP_BEHAVIOR_SETTING_LABEL}
            description="Что делает Enter в поле ввода, пока чат работает."
          >
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className={SETTINGS_DROPDOWN_TRIGGER_CLASS}
                  disabled={generalSettingsDisabled}
                  aria-label={FOLLOW_UP_BEHAVIOR_SETTING_LABEL}
                >
                  {steerActiveThreadOnEnter ? "Направить" : "В очередь"}
                  <Icon
                    name="ChevronDown"
                    className="size-3.5 text-muted-foreground"
                  />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className={cn(SETTINGS_DROPDOWN_CONTENT_CLASS, "max-w-72")}
              >
                {FOLLOW_UP_BEHAVIOR_OPTIONS.map((option) => (
                  <DropdownMenuItem
                    key={option.label}
                    className="items-start"
                    onSelect={() =>
                      onSteerActiveThreadOnEnterChange(option.steerOnEnter)
                    }
                  >
                    <span className="min-w-0">
                      <span className="block">{option.label}</span>
                      <span className="block text-2xs leading-snug text-subtle-foreground">
                        {option.description}
                      </span>
                    </span>
                    <Icon
                      name="Check"
                      className={cn(
                        "ml-auto",
                        steerActiveThreadOnEnter !== option.steerOnEnter &&
                          "opacity-0",
                        COARSE_POINTER_ICON_SIZE_CLASS,
                      )}
                    />
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </SettingsWithControl>

          <SettingsWithControl
            label="Подтверждать архивацию чата"
            description="Запрашивать подтверждение перед архивацией чата с неархивированными дочерними чатами."
          >
            <Switch
              checked={confirmThreadArchive}
              disabled={generalSettingsDisabled}
              onCheckedChange={onConfirmThreadArchiveChange}
              aria-label="Подтверждать архивацию чата"
            />
          </SettingsWithControl>

          <SettingsWithControl
            label="Показывать сообщения до очистки контекста"
            description="Предыдущие сообщения остаются в чате и доступны для чтения. Агент их не видит."
          >
            <Switch
              checked={keepHistoryAfterContextClear}
              disabled={generalSettingsDisabled}
              onCheckedChange={onKeepHistoryAfterContextClearChange}
              aria-label="Показывать сообщения до очистки контекста"
            />
          </SettingsWithControl>

          <SettingsWithControl
            label="Кратко показывать команды оболочки"
            description="Показывать краткие описания команд чтения, списка и поиска файлов. Отключите, чтобы видеть текст команды и раскрывать её вывод."
          >
            <Switch
              checked={summarizeShellCommands}
              disabled={generalSettingsDisabled}
              onCheckedChange={onSummarizeShellCommandsChange}
              aria-label="Кратко показывать команды оболочки"
            />
          </SettingsWithControl>

          <SettingsWithControl
            label="Руководство по настройке"
            description="Повторно пройти настройку агента, проектов, плагинов и устройств."
          >
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={generalSettingsDisabled}
              onClick={onReplaySetupGuide}
            >
              Показать руководство по настройке
            </Button>
          </SettingsWithControl>
        </div>
      </SettingsSection>
      <SettingsSection title="Ссылки">
        <div className="space-y-5">
          {desktopBrowserAvailable ? (
            <SettingsWithControl
              label={IN_APP_BROWSER_LINK_SETTING_LABEL}
              description="Открывать веб-ссылки внутри bb."
            >
              <Switch
                checked={openLinksInAppBrowser}
                onCheckedChange={onOpenLinksInAppBrowserChange}
                aria-label={IN_APP_BROWSER_LINK_SETTING_LABEL}
              />
            </SettingsWithControl>
          ) : null}

          {localhostRewriteDescription !== null ? (
            <SettingsWithControl
              label={REWRITE_LOCALHOST_LINKS_SETTING_LABEL}
              description={
                <span className="break-words [overflow-wrap:anywhere]">
                  {localhostRewriteDescription}
                </span>
              }
            >
              <Switch
                checked={rewriteLocalhostLinks}
                onCheckedChange={onRewriteLocalhostLinksChange}
                aria-label={REWRITE_LOCALHOST_LINKS_SETTING_LABEL}
              />
            </SettingsWithControl>
          ) : null}
          <ApplicationLinkApprovalsSettings />
        </div>
      </SettingsSection>
      <SettingsSection title="Терминалы">
        <SettingsWithControl
          label="Копировать при выделении"
          description="Автоматически копировать выделенный текст терминала и показывать уведомление. На текст в других частях приложения это не влияет. В Linux вставка средней кнопкой мыши отдельно использует основное выделение."
        >
          <Switch
            checked={terminalCopyOnSelect}
            disabled={generalSettingsDisabled}
            onCheckedChange={onTerminalCopyOnSelectChange}
            aria-label="Копировать при выделении"
          />
        </SettingsWithControl>
      </SettingsSection>
      <SettingsSection title="Git">
        <div className="space-y-5">
          <ManagedBranchPrefixSetting
            value={managedBranchPrefix}
            disabled={generalSettingsDisabled}
            onChange={onManagedBranchPrefixChange}
          />
        </div>
      </SettingsSection>
    </>
  );
}

export function PrivacySettingsSection({
  disabled,
  enabled,
  onEnabledChange,
  streamerMode,
  onStreamerModeChange,
  telemetryEnabled,
  onTelemetryEnabledChange,
}: PrivacySettingsSectionProps) {
  return (
    <SettingsSection title="Конфиденциальность и диагностика">
      <div className="space-y-5">
        <SettingsWithControl
          label={STREAMER_MODE_SETTING_LABEL}
          description="Скрывать пользовательские модели из config.json во всех списках моделей, чтобы они не были видны при демонстрации экрана."
        >
          <Switch
            checked={streamerMode}
            disabled={disabled}
            onCheckedChange={onStreamerModeChange}
            aria-label={STREAMER_MODE_SETTING_LABEL}
          />
        </SettingsWithControl>

        <SettingsWithControl
          label="Отправлять анонимные данные об использовании"
          description="Отправлять анонимные данные о запуске приложения, ходе настройки и использовании функций для улучшения bb. Отключение вступает в силу на этом сервере сразу."
        >
          <Switch
            checked={telemetryEnabled}
            disabled={disabled}
            onCheckedChange={onTelemetryEnabledChange}
            aria-label="Отправлять анонимные данные об использовании"
          />
        </SettingsWithControl>

        <SettingsWithControl
          label={DIAGNOSTIC_EVENTS_SETTING_LABEL}
          description="Показывать определение окружения провайдера и необработанные события провайдера для диагностики."
        >
          <Switch
            checked={enabled}
            disabled={disabled}
            onCheckedChange={onEnabledChange}
            aria-label={DIAGNOSTIC_EVENTS_SETTING_LABEL}
          />
        </SettingsWithControl>
      </div>
    </SettingsSection>
  );
}

const EXPERIMENT_DEFINITIONS: Record<
  ExperimentKey,
  { label: string; description: string }
> = {
  agentCpuPriority: {
    label: "Понизить приоритет CPU для агентов",
    description:
      "Сохраняет отзывчивость bb, когда агенты загружают CPU. Процессы агентов, сценарии подготовки и завершения, а также запущенные ими сборки и тесты получают пониженный приоритет CPU; в macOS для сервера bb и демона машины также применяется планирование на уровне приложения. Терминалы сохраняют обычный приоритет. Изменение вступает в силу после перезапуска bb, в том числе при обновлении.",
  },
  compactExpiredCache: {
    label: "Сжимать контекст перед продолжением сеансов с истёкшим кешем",
    description:
      "Если в неактивном чате накопилось не меньше 100 тысяч токенов и срок действия кеша запроса истёк, перед отправкой следующего сообщения появится предложение сжать контекст. Работает с поддерживаемыми провайдерами, например Claude Code и Pi.",
  },
  dismissReadNotifications: {
    label: "Убирать уведомления после прочтения чата",
    description:
      "После прочтения чата на любом устройстве убирать его уведомления с телефонов и планшетов, а также из открытых окон и вкладок bb. На телефонах нужна версия приложения с поддержкой этой функции.",
  },
  performanceDiagnostics: {
    label: "Диагностика производительности сервера",
    description:
      "Собирать профили CPU и подробные журналы производительности, когда сервер запущен с --perf-diagnostics. При выключении сбор прекращается; сохранённые профили остаются.",
  },
  pluginUpdates: {
    label: "Обновления плагинов",
    description:
      "Показывать плагины с обновлениями на странице «Обновления», обновлять их по отдельности или все сразу и учитывать их в счётчике обновлений боковой панели.",
  },
  resumeThreadsAfterRestart: {
    label: "Продолжать прерванные чаты после перезапуска",
    description:
      "Если обновление, сбой или перезапуск прерывает работающий чат либо фоновую команду, которую он ожидает, bb продолжит чат через несколько секунд после запуска и сообщит агенту, что было прервано. Сообщения, добавленные за это время в очередь, отправятся после этого.",
  },
  serverMove: {
    label: "Перенос сервера",
    description:
      "Перенесите сервер bb на другую машину через «Настройки» → «Машины» или экспортируйте и импортируйте данные сервера командой bb server.",
  },
  skipFocusedThreadNotifications: {
    label: "Не уведомлять об открытом чате",
    description:
      "Не показывать системное уведомление для чата, открытого в видимом активном окне или вкладке bb. Уведомления для других чатов и для этого же чата в неактивном окне сохраняются.",
  },
  threadContextCard: {
    label: "Карточка контекста чата",
    description:
      "Показывать изменения чата, pull request, а также родительские и дочерние чаты в карточке в правом верхнем углу панели вместо области над полем ввода. Кнопка в заголовке открывает или закрепляет карточку; в широких панелях она остаётся рядом с перепиской.",
  },
  threadRowMetadata: {
    label: "Метаданные в строках чатов",
    description:
      "Добавить пункт «Метаданные» в меню «Упорядочить» → «Строки» встроенного списка чатов. Когда он включён, плагины могут показывать детали, например pull request чата, второй строкой под названием.",
  },
  updateWhenIdle: {
    label: "Обновлять при бездействии",
    description:
      "Добавляет на страницу «Обновления» переключатель автоматического перезапуска и обновления bb. Когда он включён, bb проверяет обновления каждый час и перезапускается с новой версией, когда ни один чат не работает. Если чат запустится до перезапуска, bb снова дождётся его завершения. «Пропустить эту версию» откладывает установку до появления новой версии. Команда bb updates app apply --when-idle однократно ожидает завершения чатов из CLI.",
  },
  walCheckpointWorker: {
    label: "Фоновая запись изменений базы данных",
    description:
      "Переносить последние записи в файлы базы данных bb в фоновом потоке вместо записи при сохранении, чтобы интенсивная запись не приостанавливала сервер. Применяется сразу.",
  },
};
export function visibleExperimentKeys(
  performanceDiagnosticsAvailable: boolean,
): ExperimentKey[] {
  return experimentKeys.filter(
    (experimentKey) =>
      experimentKey !== "performanceDiagnostics" ||
      performanceDiagnosticsAvailable,
  );
}

const EARLY_ADOPTER_LABEL = "Ранний доступ";

export function ExperimentsSettingsSection({
  performanceDiagnosticsAvailable,
  disabled,
  earlyAdopter,
  onEarlyAdopterChange,
  experiments,
  onExperimentChange,
}: ExperimentsSettingsSectionProps) {
  return (
    <>
      <SettingsSection
        title="Эксперименты"
        description="Новые функции, выключенные по умолчанию. Включите их, чтобы попробовать."
        banner={
          <section
            data-settings-anchor={EARLY_ADOPTER_LABEL}
            aria-label={EARLY_ADOPTER_LABEL}
            className="flex scroll-mt-4 items-start gap-3 rounded-lg border border-border bg-accent px-4 py-3.5"
          >
            <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-background">
              <Icon
                name="Beaker"
                className="size-4 text-foreground"
                aria-hidden
              />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold text-foreground">
                Become an early adopter
              </h3>
              <p className="mt-0.5 text-xs leading-snug text-subtle-foreground">
                Получайте новые эксперименты включёнными по умолчанию раньше
                других и помогайте проверять функции до их общего выпуска.
                Эту настройку можно отключить в любой момент; выбор для
                экспериментов, которые вы переключили вручную, сохранится.
              </p>
            </div>
            <Switch
              checked={earlyAdopter}
              disabled={disabled}
              onCheckedChange={onEarlyAdopterChange}
              aria-label={EARLY_ADOPTER_LABEL}
            />
          </section>
        }
      >
        <div className="space-y-5">
          {visibleExperimentKeys(performanceDiagnosticsAvailable).map(
            (experimentKey) => {
              const definition = EXPERIMENT_DEFINITIONS[experimentKey];
              return (
                <SettingsWithControl
                  key={experimentKey}
                  label={definition.label}
                  labelBadge={
                    earlyAdopterExperiments[experimentKey]
                      ? EARLY_ADOPTER_LABEL
                      : undefined
                  }
                  description={definition.description}
                >
                  <Switch
                    checked={experiments[experimentKey]}
                    disabled={disabled}
                    onCheckedChange={(enabled) =>
                      onExperimentChange(experimentKey, enabled)
                    }
                    aria-label={definition.label}
                  />
                </SettingsWithControl>
              );
            },
          )}
        </div>
      </SettingsSection>
    </>
  );
}

export function SettingsView() {
  const navigate = useNavigate();
  const themePreference = useThemePreference();
  const systemConfigQuery = useSystemConfig();
  const { hasDaemon } = useHostDaemon();
  const { accessState, requestAccess } = useLocalHostDaemonAccess();
  const { workspaceOpenTargets } = useWorkspaceOpenTargets({
    enabled: hasDaemon,
  });
  const [directoryTargetId, setDirectoryTargetId] =
    useWorkspaceOpenTargetPreference(workspaceOpenTargets);
  const [fileTargetId, setFileTargetId] =
    useFileOpenTargetPreference(workspaceOpenTargets);
  const [openLinksInAppBrowser, setOpenLinksInAppBrowser] =
    useOpenLinksInAppBrowserPreference();
  const [rewriteLocalhostLinks, setRewriteLocalhostLinks] =
    useRewriteLocalhostLinksPreference();
  const [navigateToThreadAfterCreate, setNavigateToThreadAfterCreate] =
    useNavigateToThreadAfterCreatePreference();
  const [desktopBrowserAvailable] = useState(isDesktopBrowserAvailable);
  const experiments = systemConfigQuery.data?.experiments ?? defaultExperiments;
  const updateExperimentsMutation = useUpdateExperiments();
  const generalSettings =
    systemConfigQuery.data?.generalSettings ?? defaultAppSettings;
  const updateGeneralSettingsMutation = useUpdateGeneralSettings();
  const appearance = systemConfigQuery.data?.appearance ?? defaultAppTheme;
  const updateAppearanceMutation = useUpdateAppearance();
  const appThemePreview = useAppThemePreview();
  const location = useLocation();
  const { activePluginId, activeSection, hasUnknownSection } =
    useSettingsNavState();
  useRevealSettingsSearchTarget();
  if (hasUnknownSection) {
    return <Navigate to={SETTINGS_ROUTE_PATH} replace />;
  }

  if (activeSection === "plugins") {
    const pluginId = matchPath(SETTINGS_PLUGIN_ROUTE_PATH, location.pathname)
      ?.params.pluginId;
    return (
      <div className="-mx-4 -mt-4 flex min-h-0 flex-1 flex-col overflow-hidden md:-mx-5 md:-mt-5">
        {pluginId ? (
          <PluginDetailPaneView pluginId={pluginId} />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col pt-4 md:pt-5">
            <PluginsOverview mode="installed" />
          </div>
        )}
      </div>
    );
  }

  let content: ReactNode = null;
  if (activePluginId !== null) {
    content = <PluginSettingsPage pluginId={activePluginId} />;
  } else if (activeSection === "providers") {
    content = (
      <ProvidersSettingsSection
        disabled={systemConfigQuery.data === undefined}
        generalSettings={generalSettings}
        onGeneralSettingsChange={(next) =>
          updateGeneralSettingsMutation.mutateAsync(next).catch(() => undefined)
        }
      />
    );
  } else if (activeSection === "ai-services") {
    content = <AiServicesSettingsSection />;
  } else if (activeSection === "appearance") {
    content = (
      <AppearanceSettingsSection
        appearance={appearance}
        appearanceDisabled={
          systemConfigQuery.data === undefined ||
          updateAppearanceMutation.isPending
        }
        customThemes={systemConfigQuery.data?.customThemes ?? []}
        pluginThemes={systemConfigQuery.data?.pluginThemes ?? []}
        faviconColor={appearance.faviconColor}
        themePreference={themePreference}
        onAppearanceThemeChange={(themeId) =>
          updateAppearanceMutation.mutate(
            {
              themeId,
              faviconColor: appearance.faviconColor,
            },
            { onError: () => appThemePreview.previewTheme(null) },
          )
        }
        onAppearanceThemePrefetch={appThemePreview.prefetchThemes}
        onAppearanceThemePreview={appThemePreview.previewTheme}
        onCreatePalette={() =>
          void navigate(getRootComposeRoutePath(), {
            state: {
              focusPrompt: true,
              initialPrompt: CREATE_CUSTOM_PALETTE_PROMPT,
            },
          })
        }
        onFaviconColorChange={(faviconColor) =>
          updateAppearanceMutation.mutate({
            themeId: appearance.themeId,
            faviconColor,
          })
        }
        onThemePreferenceChange={setPreferredTheme}
      />
    );
  } else if (activeSection === "keyboard") {
    content = <KeyboardSettingsSection />;
  } else if (activeSection === "browser") {
    content = <BrowserSettingsSection />;
  } else if (activeSection === "files") {
    content = (
      <>
        <LocalOpenTargetSettingsSection
          accessState={accessState}
          directoryTargetId={directoryTargetId}
          fileTargetId={fileTargetId}
          hasDaemon={hasDaemon}
          onDirectoryTargetChange={setDirectoryTargetId}
          onFileTargetChange={setFileTargetId}
          onRequestAccess={requestAccess}
          targets={workspaceOpenTargets}
        />
        <FileOpenersSettingsSection />
      </>
    );
  } else if (activeSection === "projects") {
    content = <ProjectsSettingsSection />;
  } else if (activeSection === "machines") {
    content = (
      <>
        <MachinesSettingsSection />
        <MachineAccessSettings />
      </>
    );
  } else if (activeSection === "environment-variables") {
    content = <MachineEnvironmentSettings />;
  } else if (activeSection === "updates") {
    content = <UpdatesSettingsSection />;
  } else if (activeSection === "mobile") {
    content = <MobileAppSection />;
  } else if (activeSection === "experiments") {
    content = (
      <ExperimentsSettingsSection
        disabled={systemConfigQuery.data === undefined}
        earlyAdopter={generalSettings.earlyAdopter}
        onEarlyAdopterChange={(enabled) =>
          updateGeneralSettingsMutation.mutate({ earlyAdopter: enabled })
        }
        experiments={experiments}
        performanceDiagnosticsAvailable={
          systemConfigQuery.data?.performanceDiagnosticsAvailable ?? false
        }
        onExperimentChange={(key, enabled) =>
          updateExperimentsMutation.mutate({ [key]: enabled })
        }
      />
    );
  } else if (activeSection === "marketplaces") {
    content = <MarketplacesSettingsSection />;
  } else if (activeSection === "community") {
    content = <CommunitySettingsSection />;
  } else if (activeSection === "archived") {
    content = <ArchivedThreadsSettingsSection />;
  } else {
    content = (
      <>
        <GeneralSettingsSection
          confirmThreadArchive={generalSettings.confirmThreadArchive}
          onConfirmThreadArchiveChange={(enabled) =>
            updateGeneralSettingsMutation.mutate({
              confirmThreadArchive: enabled,
            })
          }
          keepHistoryAfterContextClear={
            generalSettings.keepHistoryAfterContextClear
          }
          onKeepHistoryAfterContextClearChange={(enabled) =>
            updateGeneralSettingsMutation.mutate({
              ...generalSettings,
              keepHistoryAfterContextClear: enabled,
            })
          }
          summarizeShellCommands={generalSettings.summarizeShellCommands}
          onSummarizeShellCommandsChange={(enabled) =>
            updateGeneralSettingsMutation.mutate({
              summarizeShellCommands: enabled,
            })
          }
          onReplaySetupGuide={() =>
            updateGeneralSettingsMutation.mutate({
              ...generalSettings,
              onboardingCompletedAt: null,
            })
          }
          desktopBrowserAvailable={desktopBrowserAvailable}
          generalSettingsDisabled={systemConfigQuery.data === undefined}
          managedBranchPrefix={generalSettings.managedBranchPrefix}
          onManagedBranchPrefixChange={async (prefix) => {
            await updateGeneralSettingsMutation.mutateAsync({
              managedBranchPrefix: prefix,
            });
          }}
          navigateToThreadAfterCreate={navigateToThreadAfterCreate}
          openLinksInAppBrowser={openLinksInAppBrowser}
          rewriteLocalhostLinks={rewriteLocalhostLinks}
          steerActiveThreadOnEnter={generalSettings.steerActiveThreadOnEnter}
          terminalCopyOnSelect={generalSettings.terminalCopyOnSelect}
          onTerminalCopyOnSelectChange={(enabled) =>
            updateGeneralSettingsMutation.mutate({
              ...generalSettings,
              terminalCopyOnSelect: enabled,
            })
          }
          onNavigateToThreadAfterCreateChange={setNavigateToThreadAfterCreate}
          onOpenLinksInAppBrowserChange={setOpenLinksInAppBrowser}
          onRewriteLocalhostLinksChange={setRewriteLocalhostLinks}
          onSteerActiveThreadOnEnterChange={(enabled) =>
            updateGeneralSettingsMutation.mutate({
              steerActiveThreadOnEnter: enabled,
            })
          }
        />
        <CliCommandSettingsSection />
        <CliSkillsSettingsSection />
        <VoiceInputSettingsSection />
        <PrivacySettingsSection
          telemetryEnabled={generalSettings.telemetryEnabled}
          onTelemetryEnabledChange={(enabled) =>
            updateGeneralSettingsMutation.mutate({
              telemetryEnabled: enabled,
            })
          }
          streamerMode={generalSettings.streamerMode}
          onStreamerModeChange={(enabled) =>
            updateGeneralSettingsMutation.mutate({
              streamerMode: enabled,
            })
          }
          enabled={generalSettings.showDiagnosticEvents}
          disabled={systemConfigQuery.data === undefined}
          onEnabledChange={(enabled) =>
            updateGeneralSettingsMutation.mutate({
              showDiagnosticEvents: enabled,
            })
          }
        />
      </>
    );
  }

  return (
    <PageShell contentClassName="pt-4 md:pt-5">
      <div className="mx-auto w-full max-w-3xl space-y-10">{content}</div>
    </PageShell>
  );
}
