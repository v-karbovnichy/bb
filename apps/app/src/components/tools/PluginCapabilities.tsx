import type { ReactNode } from "react";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { pluginCliCall } from "@bb/domain/plugin-cli";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Button } from "@bb/shared-ui/button";
import type { PluginCapability, SkillListResponse } from "@bb/server-contract";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import {
  ResourceActionButton,
  ResourceDetailIncludesSection,
  ResourceStatus,
  type ResourceStatusTone,
} from "@bb/shared-ui/resource-list";
import { cn } from "@bb/shared-ui/lib/utils";
import { PluginBannerBar } from "@/components/tools/plugin-detail-banner";
import {
  PluginDetailGlyph,
  PluginDetailRow,
  PluginDetailTable,
  PLUGIN_DETAIL_HEADER_CELL_CLASS,
  PLUGIN_DETAIL_PRIMARY_COLUMN_CLASS,
} from "@/components/tools/plugin-detail-table";
import { formatAbsoluteDate } from "@/components/plugin/management/plugin-ui";
import type { PluginRuntimeStatusPresentation } from "@/components/plugin/management/plugin-status";
import { appToast } from "@/components/ui/app-toast";
import { invalidatePluginList } from "@/hooks/cache-owners/plugin-cache-owner";
import {
  reloadPlugin,
  type PluginListItem,
} from "@/hooks/queries/plugin-settings-queries";
import { usePluginSlots, type PluginSlotSnapshot } from "@/lib/plugin-slots";
import {
  getPluginConfigurationRoutePath,
  getPluginPanelRoutePath,
  getRootComposeRoutePath,
  getSettingsRoutePath,
  getSkillDetailRoutePath,
  getSkillsRoutePath,
} from "@/lib/route-paths";
import { getPluginHomepageSectionAnchor } from "@/lib/plugin-homepage-section";
import { projectSkillsQueryKey } from "@/hooks/queries/query-keys";

function pluginActivityIcon(state: "running" | "ok" | "error" | null): {
  name: IconName;
  className: string;
  label: string;
} {
  if (state === null) {
    return {
      name: "Clock",
      className: "text-muted-foreground",
      label: "Запланировано",
    };
  }
  if (state === "running") {
    return {
      name: "Clock",
      className: "animate-shine-icon text-muted-foreground",
      label: "Работает",
    };
  }
  if (state === "ok") {
    return {
      name: "CircleCheck",
      className: "text-success",
      label: "Успешно",
    };
  }
  if (state === "error") {
    return { name: "CircleX", className: "text-destructive", label: "Ошибка" };
  }
  return {
    name: "Clock",
    className: "text-muted-foreground",
    label: "Запланировано",
  };
}

function pluginServiceStatus(state: "running" | "backoff" | "stopped"): {
  label: string;
  labelClassName?: string;
  statusClassName?: string;
  tone: ResourceStatusTone;
} {
  if (state === "running") {
    return {
      label: "Работает",
      labelClassName: "animate-shine",
      tone: "success",
    };
  }
  if (state === "backoff") {
    return {
      label: "Перезапускается",
      labelClassName: "animate-shine",
      tone: "muted",
    };
  }
  return {
    label: "Остановлено",
    statusClassName: "opacity-50",
    tone: "muted",
  };
}

function PluginActivityState({
  state,
}: {
  state: "running" | "ok" | "error" | null;
}) {
  const icon = pluginActivityIcon(state);
  return (
    <PluginDetailGlyph
      icon={icon.name}
      label={icon.label}
      className={icon.className}
    />
  );
}

interface PluginCapabilityItem {
  key: string;
  label: ReactNode;
  detail?: ReactNode;
  mono?: boolean;
  destinationPath?: string;
}

function namedSurface(
  prefix: string,
  id: string,
  title: string | undefined,
  description: string,
  destinationPath?: string,
): PluginCapabilityItem {
  const label = title?.trim() || id;
  return {
    key: `${prefix}:${id}`,
    label,
    detail:
      label === id ? (
        description
      ) : (
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
          <span>{description}</span>
          <span className="break-all font-mono text-subtle-foreground">
            {id}
          </span>
        </span>
      ),
    mono: label === id,
    destinationPath,
  };
}

function namedSlotItems<
  Slot extends { pluginId: string; id: string; title?: string },
>(
  pluginId: string,
  slots: readonly Slot[],
  prefix: string,
  description: string,
  destinationPath?: (slot: Slot) => string,
): PluginCapabilityItem[] {
  return slots
    .filter((slot) => slot.pluginId === pluginId)
    .map((slot) =>
      namedSurface(
        prefix,
        slot.id,
        slot.title,
        description,
        destinationPath?.(slot),
      ),
    );
}

function pluginAppSurfaceItems(
  plugin: PluginListItem,
  slots: PluginSlotSnapshot,
  configurationPath: string | undefined,
): PluginCapabilityItem[] {
  const pluginId = plugin.id;
  const settingsSections = slots.settingsSections.filter(
    (section) => section.pluginId === pluginId,
  );
  return [
    ...(plugin.hasSettings || settingsSections.length > 0
      ? [
          namedSurface(
            "settings",
            "settings",
            "Настройки",
            "Открывает настройки этого плагина.",
            configurationPath ?? getPluginConfigurationRoutePath({ pluginId }),
          ),
        ]
      : []),
    ...namedSlotItems(
      pluginId,
      slots.navPanels.filter(
        (panel) => panel.experimental_hideFromNavigation !== true,
      ),
      "nav",
      "Добавляет страницу на боковую панель приложения.",
      (panel) =>
        getPluginPanelRoutePath({
          pluginId,
          path: panel.path,
        }),
    ),
    ...namedSlotItems(
      pluginId,
      slots.navPanels.filter(
        (panel) => panel.experimental_hideFromNavigation === true,
      ),
      "nav",
      "Добавляет страницу, которую плагин открывает сам, вне навигации.",
      (panel) =>
        getPluginPanelRoutePath({
          pluginId,
          path: panel.path,
        }),
    ),
    ...namedSlotItems(
      pluginId,
      slots.homepageSections,
      "homepage",
      "Добавляет содержимое на главную страницу.",
      (section) =>
        `${getRootComposeRoutePath()}#${getPluginHomepageSectionAnchor(pluginId, section.id)}`,
    ),
    ...namedSlotItems(
      pluginId,
      slots.appOverlays,
      "app-overlay",
      "Показывает плавающий интерфейс во всём приложении.",
    ),
    ...namedSlotItems(
      pluginId,
      slots.threadLists,
      "thread-list",
      "Может заменить список чатов на боковой панели; настраивается в разделе «Внешний вид».",
      () => getSettingsRoutePath("appearance"),
    ),
    ...namedSlotItems(
      pluginId,
      slots.experimentalSidebarNavigations,
      "sidebar-navigation",
      "Может отображать навигацию на боковой панели; настраивается в разделе «Внешний вид».",
      () => getSettingsRoutePath("appearance"),
    ),
    ...namedSlotItems(
      pluginId,
      slots.sourceCodeRenderers,
      "source-code-renderer",
      "Изменяет отображение исходного кода во всём приложении.",
    ),
    ...namedSlotItems(
      pluginId,
      slots.diffRenderers,
      "diff-renderer",
      "Изменяет отображение различий во всём приложении.",
    ),
    ...namedSlotItems(
      pluginId,
      slots.composers,
      "composer",
      "Может заменить поле ввода чата; настраивается в разделе «Внешний вид».",
      () => getSettingsRoutePath("appearance"),
    ),
    ...namedSlotItems(
      pluginId,
      slots.threadPanelActions,
      "thread-panel",
      "Добавляет действие, открывающее панель рядом с чатом.",
    ),
    ...namedSlotItems(
      pluginId,
      slots.newThreadPanelActions,
      "new-thread-panel",
      "Добавляет действие, открывающее панель рядом с экраном нового чата.",
    ),
    ...namedSlotItems(
      pluginId,
      slots.pendingInteractions,
      "input",
      "Показывает пользовательский интерфейс внутри чата.",
    ),
    ...slots.sidebarFooterItems
      .filter((slot) => slot.pluginId === pluginId)
      .map((slot) =>
        namedSurface(
          "sidebar-footer",
          slot.id,
          slot.label,
          slot.kind === "action"
            ? "Добавляет действие в нижнюю часть боковой панели."
            : "Добавляет содержимое, открываемое из нижней части боковой панели.",
        ),
      ),
    ...namedSlotItems(
      pluginId,
      slots.messageActions,
      "message-action",
      "Добавляет действие к сообщениям в чатах.",
    ),
    ...namedSlotItems(
      pluginId,
      slots.threadHeaderActions,
      "thread-header",
      "Добавляет действие к заголовкам чатов.",
    ),
    ...namedSlotItems(
      pluginId,
      slots.threadContextSegments,
      "thread-context",
      "Показывает контекст рядом с полем ввода чата.",
    ),
    ...namedSlotItems(
      pluginId,
      slots.threadRowMetadata,
      "thread-row-item",
      "Добавляет элемент к каждой строке чата на боковой панели.",
    ),
    ...namedSlotItems(
      pluginId,
      slots.threadInfoRows,
      "thread-info-row",
      "Добавляет строку на вкладку сведений о чате.",
    ),
    ...namedSlotItems(
      pluginId,
      slots.threadInfoSections,
      "thread-info-section",
      "Добавляет раздел на вкладку сведений о чате.",
    ),
    ...namedSlotItems(
      pluginId,
      slots.threadHeaderRows,
      "thread-header-row",
      "Добавляет строку под заголовком чата.",
    ),
    ...namedSlotItems(
      pluginId,
      slots.threadHeaderTitles,
      "thread-header-title",
      "Заменяет название чата в заголовке.",
    ),
    ...namedSlotItems(
      pluginId,
      slots.threadContextCardRows,
      "thread-context-card-row",
      "Добавляет строку на карточку контекста чата.",
    ),
    ...namedSlotItems(
      pluginId,
      slots.threadContextCardSections,
      "thread-context-card-section",
      "Добавляет раздел на карточку контекста чата.",
    ),
    ...namedSlotItems(
      pluginId,
      slots.threadActions,
      "thread-action",
      "Добавляет действие в меню чата.",
    ),
    ...namedSlotItems(
      pluginId,
      slots.browserToolbarActions,
      "browser-toolbar",
      "Добавляет действие на панель инструментов вкладки браузера.",
    ),
    ...slots.composerCustomizations
      .filter((slot) => slot.pluginId === pluginId)
      .flatMap((slot) => [
        ...(slot.actions ?? []).map((action) =>
          namedSurface(
            `composer:${slot.id}:action`,
            action.id,
            undefined,
            "Добавляет действие рядом с полем ввода чата.",
          ),
        ),
        ...(slot.experimental_popups ?? []).map((popup) =>
          namedSurface(
            `composer:${slot.id}:popup:${popup.id}`,
            popup.id,
            popup.label,
            "Открывает содержимое плагина рядом с полем ввода, на месте меню упоминаний.",
          ),
        ),
        ...(slot.banners ?? []).map((banner) =>
          namedSurface(
            `composer:${slot.id}:banner`,
            banner.id,
            undefined,
            "Показывает сведения над полем ввода чата.",
          ),
        ),
        ...(slot.plusMenu ?? []).map((item) =>
          namedSurface(
            `composer:${slot.id}:plus-menu`,
            item.id,
            item.label,
            "Добавляет элемент в меню добавления поля ввода.",
          ),
        ),
        ...(slot.richText?.effects ?? []).map((effect) =>
          namedSurface(
            `composer:${slot.id}:rich-text`,
            effect.id,
            undefined,
            "Добавляет форматирование текста при составлении сообщения.",
          ),
        ),
      ]),
    ...slots.fileOpeners
      .filter((slot) => slot.pluginId === pluginId)
      .map((slot) => ({
        ...namedSurface(
          "file",
          slot.id,
          slot.title,
          "Открывает поддерживаемые файлы в просмотрщике плагина.",
          getSettingsRoutePath("files"),
        ),
        detail:
          slot.extensions.length === 0 ? (
            <span>
              Открывает файлы, показанные плагином, в просмотрщике плагина.
            </span>
          ) : (
            <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
              <span>Открывает эти файлы в просмотрщике плагина:</span>
              <span className="font-mono">
                {slot.extensions.map((extension) => `.${extension}`).join(", ")}
              </span>
            </span>
          ),
      })),
    ...slots.messageDirectives
      .filter((slot) => slot.pluginId === pluginId)
      .map((slot) => ({
        key: `directive:${slot.id}`,
        label: `::${slot.id}`,
        detail: "Показывает содержимое плагина в сообщениях чата.",
        mono: true,
      })),
    ...slots.codeFenceRenderers
      .filter((slot) => slot.pluginId === pluginId)
      .map((slot) => ({
        key: `code-fence:${slot.id}`,
        label: slot.languages.map((language) => `\`\`\`${language}`).join(", "),
        detail: "Показывает эти блоки кода в сообщениях ассистента.",
        mono: true,
      })),
  ];
}

export function PluginIncludes({
  plugin,
  configurationPath,
}: {
  plugin: PluginListItem;
  configurationPath?: string;
}) {
  const slots = usePluginSlots();
  const queryClient = useQueryClient();
  const cachedSkills = queryClient.getQueryData<SkillListResponse>(
    projectSkillsQueryKey(PERSONAL_PROJECT_ID),
  );
  const appItems = pluginAppSurfaceItems(plugin, slots, configurationPath);

  const skillDestination = (capabilityId: string): string => {
    const installedSkill = cachedSkills?.skills.find((skill) => {
      if (skill.pluginId !== plugin.id) return false;
      const segments = skill.filePath.split(/[\\/]/u);
      return segments.at(-2) === capabilityId || skill.name === capabilityId;
    });
    return installedSkill === undefined
      ? `${getSkillsRoutePath()}?view=library`
      : getSkillDetailRoutePath({ skillId: installedSkill.id });
  };

  const declared = (kind: PluginCapability["kind"]): PluginCapabilityItem[] =>
    plugin.capabilities
      .filter((capability) => capability.kind === kind)
      .map((capability) => ({
        key: `${capability.kind}:${capability.id}`,
        label: capability.label,
        detail: capability.detail ?? undefined,
        mono: kind === "skill" || kind === "agent-tool",
        destinationPath:
          kind === "theme"
            ? getSettingsRoutePath("appearance")
            : kind === "skill"
              ? skillDestination(capability.id)
              : undefined,
      }));

  const categories: Array<{
    icon: IconName;
    kind: string;
    items: PluginCapabilityItem[];
  }> = [
    {
      icon: "AppWindow",
      kind: "Экран приложения",
      items: appItems,
    },
    {
      icon: "Terminal",
      kind: "Команда",
      items: plugin.cliCommand
        ? [
            {
              key: plugin.cliCommand.name,
              label: pluginCliCall(plugin.id, plugin.cliCommand.name),
              detail: plugin.cliCommand.summary || undefined,
              mono: true,
            },
          ]
        : [],
    },
    {
      icon: "Explore",
      kind: "Навык",
      items: declared("skill"),
    },
    {
      icon: "Toolbox",
      kind: "Инструмент агента",
      items: declared("agent-tool"),
    },
    {
      icon: "MessageCirclePlus",
      kind: "Интеграция с чатом",
      items: declared("thread-integration"),
    },
    {
      icon: "Palette",
      kind: "Тема",
      items: declared("theme"),
    },
  ];
  const items = categories.flatMap(({ icon, kind, items: groupItems }) =>
    groupItems.map((item) => ({ ...item, icon, kind })),
  );

  if (!plugin.enabled || items.length === 0) return null;

  const live =
    plugin.status === "running" ||
    plugin.status === "degraded" ||
    plugin.status === "needs-configuration";
  const liveCapabilitiesNote =
    "Плагин не запущен, поэтому нельзя показать его команды, настройки, инструменты агента, экраны приложения и интеграции с чатом.";

  return (
    <ResourceDetailIncludesSection label="Возможности">
      <div className="space-y-3">
        <PluginDetailTable>
          {items.map((item) => (
            <PluginDetailRow
              key={item.key}
              glyph={
                <PluginDetailGlyph
                  icon={item.icon}
                  label={item.kind}
                  className="text-muted-foreground"
                />
              }
              name={
                item.destinationPath === undefined ? (
                  item.label
                ) : (
                  <Link
                    to={item.destinationPath}
                    className="rounded-sm text-xs underline decoration-border underline-offset-4 transition-colors hover:decoration-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    {item.label}
                  </Link>
                )
              }
              nameClassName="text-xs"
              mono={item.mono}
              detail={item.detail}
            />
          ))}
        </PluginDetailTable>
        {live ? null : (
          <p className="text-xs leading-relaxed text-muted-foreground">
            {liveCapabilitiesNote}
          </p>
        )}
      </div>
    </ResourceDetailIncludesSection>
  );
}

function PluginRuntimeStatusAlert({
  plugin,
  runtimeStatus,
  configurationPath,
  onReload,
  reloadPending,
}: {
  plugin: PluginListItem;
  runtimeStatus: PluginRuntimeStatusPresentation;
  configurationPath: string | undefined;
  onReload: () => void;
  reloadPending: boolean;
}) {
  const { settingsSections } = usePluginSlots();
  const hasSettingsPage =
    plugin.hasSettings ||
    settingsSections.some((section) => section.pluginId === plugin.id);
  const canOpenSettings =
    plugin.status === "needs-configuration" && hasSettingsPage;
  const canReload =
    plugin.status === "error" ||
    plugin.status === "degraded" ||
    (plugin.status === "missing" && plugin.source.startsWith("path:")) ||
    (plugin.status === "needs-configuration" && !plugin.hasSettings);
  const detail = [runtimeStatus.condition, runtimeStatus.recovery]
    .filter((part): part is string => part !== null && part.length > 0)
    .map((part) => {
      const capitalized = `${part.charAt(0).toUpperCase()}${part.slice(1)}`;
      return /[.!?]$/u.test(capitalized) ? capitalized : `${capitalized}.`;
    })
    .join(" ");
  return (
    <PluginBannerBar
      role={plugin.status === "starting" ? "status" : "alert"}
      tone={runtimeStatus.tone === "error" ? "destructive" : runtimeStatus.tone}
      icon={runtimeStatus.icon}
      title={runtimeStatus.label}
      detail={canOpenSettings ? undefined : detail}
      separator={plugin.status !== "degraded"}
      action={
        canOpenSettings || canReload ? (
          <span className="flex items-center gap-2">
            {canOpenSettings ? (
              <Button
                asChild
                variant="ghost"
                size="sm"
                className="h-7 gap-0.5 px-2.5 text-xs font-normal text-muted-foreground hover:text-foreground [&_[data-icon-root]]:size-3"
              >
                <Link
                  to={
                    configurationPath ??
                    getPluginConfigurationRoutePath({ pluginId: plugin.id })
                  }
                >
                  Открыть настройки
                  <Icon name="ChevronRight" className="size-3.5" aria-hidden />
                </Link>
              </Button>
            ) : null}
            {canReload ? (
              <ResourceActionButton
                icon="RotateCcw"
                className="[&_[data-icon-root]]:size-3.5"
                label={reloadPending ? "Перезагрузка…" : "Перезагрузить"}
                loading={reloadPending}
                disabled={reloadPending}
                onClick={onReload}
              />
            ) : null}
          </span>
        ) : undefined
      }
    />
  );
}

export function PluginHealthBanner({
  plugin,
  runtimeStatus,
  configurationPath,
}: {
  plugin: PluginListItem;
  runtimeStatus: PluginRuntimeStatusPresentation | null;
  configurationPath?: string;
}) {
  const queryClient = useQueryClient();
  const reload = useMutation({
    meta: { showErrorToast: false },
    mutationFn: () => reloadPlugin(fetch, plugin.id),
    onSuccess: () => invalidatePluginList({ queryClient }),
    onError: (error) => {
      appToast.error("Не удалось перезагрузить плагин", {
        description: error instanceof Error ? error.message : String(error),
      });
    },
  });
  const showOverallState = plugin.enabled && runtimeStatus !== null;
  if (!showOverallState || runtimeStatus === null) return null;
  return (
    <PluginRuntimeStatusAlert
      plugin={plugin}
      runtimeStatus={runtimeStatus}
      configurationPath={configurationPath}
      reloadPending={reload.isPending}
      onReload={() => reload.mutate()}
    />
  );
}

export function PluginServices({ plugin }: { plugin: PluginListItem }) {
  return (
    <div className="@container/plugin-detail max-w-full overflow-hidden rounded-lg border border-border bg-card align-top">
      <table
        aria-label="Фоновые службы"
        className="w-full max-w-full table-fixed border-collapse text-left"
      >
        <colgroup>
          <col className={PLUGIN_DETAIL_PRIMARY_COLUMN_CLASS} />
          <col />
        </colgroup>
        <thead className="text-xs text-muted-foreground">
          <tr className="border-b border-border">
            <th
              scope="col"
              className={cn(
                PLUGIN_DETAIL_HEADER_CELL_CLASS,
                "px-4 py-2 font-medium",
              )}
            >
              Состояние
            </th>
            <th
              scope="col"
              className={cn(
                PLUGIN_DETAIL_HEADER_CELL_CLASS,
                "border-l border-border px-4 py-2 font-medium",
              )}
            >
              Служба
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {plugin.services.map((service) => {
            const status = pluginServiceStatus(service.state);
            return (
              <tr key={service.name}>
                <td
                  className={cn(
                    "px-4 py-1.5 align-middle text-left",
                    status.statusClassName,
                  )}
                >
                  <ResourceStatus tone={status.tone}>
                    <span className={status.labelClassName}>
                      {status.label}
                    </span>
                  </ResourceStatus>
                </td>
                <th
                  scope="row"
                  className="break-words border-l border-border px-4 py-1.5 text-left text-sm font-normal leading-snug text-foreground"
                >
                  {service.name}
                </th>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function PluginSchedules({ plugin }: { plugin: PluginListItem }) {
  return (
    <PluginDetailTable>
      {plugin.schedules.map((schedule) => (
        <PluginDetailRow
          key={schedule.name}
          glyph={<PluginActivityState state={schedule.lastStatus} />}
          name={schedule.name}
          detail={
            schedule.lastError ??
            `Следующий запуск: ${formatAbsoluteDate(schedule.nextRunAt)}`
          }
        />
      ))}
    </PluginDetailTable>
  );
}
