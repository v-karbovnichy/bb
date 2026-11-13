import { PluginNameTag } from "@/components/plugin/management/PluginNameTag";
import { splitPluginDisplayName } from "@bb/domain/plugin-display-name";
import { PluginCardAuthorAvatar } from "@/components/plugin/management/PluginCard";
import { CURATED_PLUGIN_MARKETPLACE_NAME } from "@bb/server-contract";
import { useSyncExternalStore } from "react";
import {
  ResourceActionButton,
  ResourceActivitySection,
  ResourceDefinitionSection,
  ResourceDetailPage,
  ResourceDetailReleaseSection,
  ResourceDetailStack,
  ResourceListState,
  ResourceOverflowMenu,
  type ResourceOverflowMenuItem,
} from "@bb/shared-ui/resource-list";
import { Switch } from "@bb/shared-ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@bb/shared-ui/tooltip";
import { formatHomePathForDisplay } from "@bb/shared-ui/lib/utils";
import { Icon } from "@bb/shared-ui/icon";
import { useNavigate } from "react-router-dom";
import { getPluginConfigurationRoutePath } from "@/lib/route-paths";
import { reviewableRangeUpgrade } from "@/components/plugin/management/plugin-status";
import {
  PluginDetailReleaseControl,
  PluginDetailReleaseStatus,
  pluginHasUpdateSurfaces,
} from "@/components/plugin/management/PluginUpdatesCard";
import {
  CatalogEntryIconChip,
  formatAbsoluteDate,
  PluginLogo,
  pluginInstallCountPresentation,
} from "@/components/plugin/management/plugin-ui";
import {
  PluginDetailMetadata,
  PluginDetailMetadataItem,
  PluginMarketplaceByline,
  PluginMarketplaceDetailMetadata,
  PluginMarketplaceListingSections,
  PluginMarketplaceOverview,
  PluginMarketplaceSource,
  PluginMoreFromAuthorSection,
  PluginOverviewLead,
} from "@/components/plugin/management/PluginMarketplaceListing";
import { pluginRuntimeStatusPresentation } from "@/components/plugin/management/plugin-status";
import { PluginCatalogInstallControl } from "@/components/plugin/management/PluginCatalogInstallControl";
import {
  useCancelPluginInstallJob,
  useCatalogEntryInstallJob,
} from "@/hooks/queries/plugin-install-job-queries";
import {
  catalogEntryDetailKey,
  catalogEntryInstallBlocker,
} from "@/components/plugin/management/installed-plugin-catalog";
import {
  PluginHealthBanner,
  PluginIncludes,
  PluginSchedules,
  PluginServices,
} from "@/components/tools/PluginCapabilities";
import {
  PluginBannerBar,
  PluginBannerOpenButton,
} from "@/components/tools/plugin-detail-banner";
import {
  usePluginSource,
  usePluginUpdateCheck,
  type PluginCatalogSearchEntry,
} from "@/hooks/queries/plugin-catalog-queries";
import type { PluginListItem } from "@/hooks/queries/plugin-settings-queries";
import {
  getPluginFrontendDiagnostics,
  subscribePluginFrontendDiagnostics,
  type PluginFrontendDiagnostic,
} from "@/lib/plugin-frontend";
import { usePluginSlots } from "@/lib/plugin-slots";
import { copyToClipboardWithToast, useClipboardCopy } from "@/lib/clipboard";

function pluginMarketplaceUrl({
  marketplace,
  entryId,
}: {
  marketplace: string | null;
  entryId: string | null;
}): string | null {
  if (marketplace !== CURATED_PLUGIN_MARKETPLACE_NAME || entryId === null) {
    return null;
  }
  return `https://getbb.app/marketplace/${encodeURIComponent(entryId)}`;
}

function copyMarketplaceLinkItems(
  url: string | null,
): ResourceOverflowMenuItem[] {
  if (url === null) return [];
  return [
    {
      label: "Скопировать ссылку на каталог",
      icon: "Copy",
      onSelect: () =>
        void copyToClipboardWithToast(url, {
          successMessage: "Ссылка на каталог скопирована",
          errorMessage: "Не удалось скопировать ссылку на каталог.",
        }),
    },
  ];
}

export function pluginIsLocalSource(plugin: PluginListItem): boolean {
  return plugin.source.startsWith("path:");
}

export function pluginRemovalLabel(plugin: PluginListItem): string {
  return pluginIsLocalSource(plugin) ? "Удалить из bb" : "Удалить";
}

export function pluginRemovalDescription(plugin: PluginListItem): string {
  return pluginIsLocalSource(plugin)
    ? `Удалить «${plugin.id}» из bb вместе с настройками, секретами и расписаниями? Исходные файлы останутся на диске. Чтобы перенести плагин в другую папку и сохранить настройки, установите его по новому пути.`
    : `Удалить «${plugin.id}» вместе с управляемыми файлами, настройками, секретами и расписаниями?`;
}

function PluginLocalSource({
  path,
  notice,
  openDisabled,
  onOpen,
}: {
  path: string;
  notice: string | null;
  openDisabled: boolean;
  onOpen: () => void;
}) {
  const { copied, copy } = useClipboardCopy({
    text: path,
    errorMessage: "Не удалось скопировать путь.",
  });

  return (
    <ResourceDefinitionSection label="Источник">
      <div className="flex min-w-0 items-center gap-3">
        <Icon
          name="Folder"
          className="size-4 shrink-0 text-muted-foreground"
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <TooltipProvider delayDuration={250}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  tabIndex={0}
                  className="block truncate rounded-sm font-mono text-xs text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  {formatHomePathForDisplay(path)}
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-sm break-all">
                {path}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <ResourceActionButton
            label="Открыть исходник"
            icon="ExternalLink"
            disabled={openDisabled}
            disabledReason={openDisabled ? "Редактор не настроен" : undefined}
            onClick={onOpen}
          />
          <ResourceActionButton
            label={`Скопировать путь к плагину: ${path}`}
            tooltipLabel={copied ? "Скопировано" : "Скопировать путь"}
            icon={copied ? "Check" : "Copy"}
            onClick={() => void copy()}
          />
        </div>
      </div>
      {notice === null ? null : (
        <p
          className="mt-2 flex items-start gap-1.5 text-2xs leading-snug text-subtle-foreground"
          data-testid="plugin-source-notice"
        >
          <Icon name="Info" className="mt-0.5 size-3 shrink-0" aria-hidden />
          <span className="min-w-0 break-words">{notice}</span>
        </p>
      )}
    </ResourceDefinitionSection>
  );
}

const OFFICIAL_BYLINE_ENTRY = {
  author: null,
  marketplace: "bb-official",
  publisherLabel: "Официальный BB",
} as const;

export function CatalogPluginDetail({
  entry,
  onInstall,
  catalogEntries,
  onOpenPlugin,
}: {
  entry: PluginCatalogSearchEntry;
  onInstall: (entry: PluginCatalogSearchEntry) => void;
  catalogEntries: readonly PluginCatalogSearchEntry[];
  onOpenPlugin: (pluginId: string) => void;
}) {
  const presentation = pluginInstallCountPresentation(entry);
  const count = presentation?.tone === "count" ? presentation : undefined;
  const installBlocker = catalogEntryInstallBlocker(entry);
  const installJob = useCatalogEntryInstallJob(entry);
  const { mutate: cancelInstall } = useCancelPluginInstallJob();
  const overflowItems = copyMarketplaceLinkItems(pluginMarketplaceUrl(entry));
  const entryTitle = splitPluginDisplayName(entry.displayName);
  return (
    <ResourceDetailPage
      maxWidthClassName="max-w-5xl"
      leading={<CatalogEntryIconChip entry={entry} compact />}
      leadingClassName="size-6"
      title={entryTitle.name}
      titleMeta={
        entryTitle.tag ? <PluginNameTag tag={entryTitle.tag} /> : undefined
      }
      metadataLeading={<PluginCardAuthorAvatar entry={entry} />}
      metadata={<PluginMarketplaceByline entry={entry} />}
      actions={
        <PluginCatalogInstallControl
          displayName={entry.displayName}
          installed={false}
          showLabel
          disabled={installBlocker !== null}
          unavailableReason={installBlocker}
          count={count}
          onInstall={() => onInstall(entry)}
          installJob={installJob}
          onCancelInstall={cancelInstall}
        />
      }
      overflowMenu={
        overflowItems.length === 0 ? undefined : (
          <ResourceOverflowMenu
            label={`Действия с ${entry.displayName}`}
            items={overflowItems}
          />
        )
      }
    >
      <ResourceDetailStack>
        <PluginMarketplaceListingSections entry={entry} />
        <PluginMoreFromAuthorSection
          entry={entry}
          catalogEntries={catalogEntries}
          onOpenPlugin={onOpenPlugin}
        />
      </ResourceDetailStack>
    </ResourceDetailPage>
  );
}

export function CatalogPluginDetailBanner({
  entry,
  onOpenPlugin,
}: {
  entry: PluginCatalogSearchEntry;
  onOpenPlugin: (pluginId: string) => void;
}) {
  if (entry.incompatibleReason !== null) {
    return (
      <PluginBannerBar
        tone="warning"
        icon="AlertTriangle"
        title="Обновите bb для установки плагина"
        detail={entry.incompatibleReason}
      />
    );
  }
  if (entry.conflictingInstallSource === null) return null;
  return (
    <PluginBannerBar
      tone="warning"
      icon="AlertTriangle"
      title="Другой плагин использует этот ID"
      detail={`удалите установленный плагин «${entry.pluginId}», чтобы установить этот.`}
      action={
        <PluginBannerOpenButton
          label="Показать установленный плагин"
          onClick={() => onOpenPlugin(entry.pluginId)}
        />
      }
    />
  );
}

function pluginHealthBannerState(
  plugin: PluginListItem,
  frontendDiagnostic: PluginFrontendDiagnostic | undefined,
): { plugin: PluginListItem } | null {
  if (!plugin.enabled) return null;
  if (pluginRuntimeStatusPresentation(plugin) !== null) return { plugin };

  if (pluginFrontendDiagnosticRequiresFailureBanner(frontendDiagnostic)) {
    return {
      plugin: {
        ...plugin,
        status: "error",
        statusDetail: null,
      },
    };
  }
  return null;
}

export function pluginFrontendDiagnosticRequiresFailureBanner(
  diagnostic: PluginFrontendDiagnostic | undefined,
): boolean {
  return diagnostic?.status === "failed";
}

export function PluginDetailBanners({
  plugin,
  configurationPath,
  catalogEntries,
  onOpenPlugin,
}: {
  plugin: PluginListItem;
  configurationPath?: string;
  catalogEntries: readonly PluginCatalogSearchEntry[];
  onOpenPlugin: (pluginId: string) => void;
}) {
  const frontendDiagnostics = useSyncExternalStore(
    subscribePluginFrontendDiagnostics,
    getPluginFrontendDiagnostics,
    getPluginFrontendDiagnostics,
  );
  const frontendDiagnostic = frontendDiagnostics.get(plugin.id);
  const banner = pluginHealthBannerState(plugin, frontendDiagnostic);
  const publishedListing = catalogEntries.find(
    (entry) =>
      entry.pluginId === plugin.id && entry.conflictingInstallSource !== null,
  );
  return (
    <>
      {banner === null ? null : (
        <PluginHealthBanner
          plugin={banner.plugin}
          configurationPath={configurationPath}
          runtimeStatus={pluginRuntimeStatusPresentation(banner.plugin)}
        />
      )}
      {publishedListing === undefined ? null : (
        <PluginBannerBar
          tone="muted"
          icon="Info"
          title={`Также опубликован в ${publishedListing.marketplaceDisplayName}`}
          action={
            <PluginBannerOpenButton
              label="Открыть запись в каталоге"
              onClick={() =>
                onOpenPlugin(catalogEntryDetailKey(publishedListing))
              }
            />
          }
        />
      )}
    </>
  );
}

export function PluginDetail({
  isLoading,
  plugin,
  pending,
  openSourceDisabled,
  onToggle,
  onEdit,
  onOpenSource,
  onDelete,
  catalogEntry,
  catalogEntries,
  onOpenPlugin,
  onConfigure,
  configurationPath,
}: {
  isLoading: boolean;
  plugin: PluginListItem | null;
  pending: boolean;
  openSourceDisabled: boolean;
  onToggle: (plugin: PluginListItem) => void;
  onEdit: (plugin: PluginListItem) => void;
  onOpenSource: (plugin: PluginListItem) => void;
  onDelete: (plugin: PluginListItem) => void;
  catalogEntry?: PluginCatalogSearchEntry;
  catalogEntries: readonly PluginCatalogSearchEntry[];
  onOpenPlugin: (pluginId: string) => void;
  onConfigure?: () => void;
  configurationPath?: string;
}) {
  const navigate = useNavigate();
  const { settingsSections } = usePluginSlots();
  const sourceQuery = usePluginSource(plugin?.id ?? "", {
    enabled: plugin !== null && !plugin.source.startsWith("builtin:"),
  });
  usePluginUpdateCheck(plugin?.id ?? null, {
    enabled: plugin !== null && pluginHasUpdateSurfaces(plugin),
  });
  if (isLoading) {
    return (
      <ResourceListState
        state="loading"
        message="Загрузка плагинов"
        layout="detail"
        maxWidthClassName="max-w-5xl"
      />
    );
  }

  if (plugin === null) {
    return (
      <ResourceListState
        state="empty"
        message="Плагин не найден."
        layout="detail"
        maxWidthClassName="max-w-5xl"
      />
    );
  }

  const hasUpdateManagement = pluginHasUpdateSurfaces(plugin);
  const canEditSource = pluginIsLocalSource(plugin);
  const updatesWithBb = plugin.source.startsWith("builtin:");
  const installedAt = sourceQuery.data?.installedAt ?? null;
  const installedValue = updatesWithBb
    ? "Обновляется вместе с bb"
    : installedAt !== null
      ? formatAbsoluteDate(installedAt)
      : sourceQuery.isPending
        ? "Загрузка…"
        : "Дата установки недоступна";
  const hasReleaseControl =
    hasUpdateManagement &&
    (plugin.updateState.availableVersion !== null ||
      reviewableRangeUpgrade(plugin) !== null);
  const hasReleaseUpdate =
    hasUpdateManagement &&
    (plugin.updateState.availableVersion !== null ||
      plugin.updateState.blockedVersion !== null ||
      plugin.updateState.rangeUpgrade !== null ||
      plugin.updateState.lastFailure !== null);
  const hasConfiguration =
    plugin.hasSettings ||
    settingsSections.some((section) => section.pluginId === plugin.id);

  const pluginName = plugin.name ?? plugin.id;
  const pluginTitle = splitPluginDisplayName(pluginName);
  const marketplaceUrl = pluginMarketplaceUrl(
    catalogEntry ?? {
      marketplace: plugin.catalogMarketplaceName,
      entryId: plugin.catalogEntryId,
    },
  );
  const overflowItems: ResourceOverflowMenuItem[] = [
    ...copyMarketplaceLinkItems(marketplaceUrl),
    ...(canEditSource
      ? [
          {
            label: "Редактировать",
            icon: "Edit" as const,
            disabled: pending,
            onSelect: () => onEdit(plugin),
          },
        ]
      : []),
    {
      label: pluginRemovalLabel(plugin),
      icon: "Trash2" as const,
      tone: "destructive" as const,
      disabled: pending || plugin.provenance === "builtin",
      disabledReason:
        plugin.provenance === "builtin"
          ? "Плагин входит в BB. Его можно отключить."
          : undefined,
      onSelect: () => onDelete(plugin),
    },
  ];
  const bylineEntry =
    catalogEntry ??
    (plugin.provenance === "builtin" ||
    plugin.catalogMarketplaceName === "bb-official"
      ? OFFICIAL_BYLINE_ENTRY
      : undefined);
  return (
    <ResourceDetailPage
      maxWidthClassName="max-w-5xl"
      leading={<PluginLogo plugin={plugin} className="size-4" />}
      title={pluginTitle.name}
      titleMeta={
        pluginTitle.tag ? <PluginNameTag tag={pluginTitle.tag} /> : undefined
      }
      metadataLeading={
        bylineEntry === undefined ? undefined : (
          <PluginCardAuthorAvatar entry={bylineEntry} />
        )
      }
      metadata={
        bylineEntry === undefined ? undefined : (
          <PluginMarketplaceByline entry={bylineEntry} />
        )
      }
      actions={
        hasConfiguration ? (
          <ResourceActionButton
            label={`Настройки ${pluginName}`}
            tooltipLabel="Настройки"
            icon="Settings"
            onClick={() => {
              if (onConfigure) {
                onConfigure();
                return;
              }
              void navigate(
                getPluginConfigurationRoutePath({ pluginId: plugin.id }),
              );
            }}
          />
        ) : undefined
      }
      lifecycleControl={
        <Switch
          checked={plugin.enabled}
          disabled={pending}
          aria-label={`${plugin.enabled ? "Отключить" : "Включить"} ${pluginName}`}
          onCheckedChange={() => onToggle(plugin)}
        />
      }
      overflowMenu={
        <ResourceOverflowMenu
          label={`Действия с ${pluginName}`}
          items={overflowItems}
        />
      }
    >
      <ResourceDetailStack>
        {catalogEntry === undefined ? (
          <section
            className="max-w-prose"
            data-resource-detail-section="overview"
          >
            <PluginOverviewLead
              description={
                plugin.description ?? "У плагина нет описания."
              }
            />
          </section>
        ) : (
          <PluginMarketplaceOverview entry={catalogEntry} />
        )}
        {canEditSource ? (
          <PluginLocalSource
            path={plugin.rootDir}
            notice={plugin.sourceNotice}
            openDisabled={pending || openSourceDisabled}
            onOpen={() => onOpenSource(plugin)}
          />
        ) : catalogEntry !== undefined ? (
          <PluginMarketplaceSource entry={catalogEntry} />
        ) : null}
        <ResourceDetailReleaseSection
          label="Сведения"
          actions={
            hasReleaseControl ? (
              <PluginDetailReleaseControl plugin={plugin} />
            ) : undefined
          }
        >
          <PluginDetailMetadata>
            {catalogEntry === undefined ? null : (
              <PluginMarketplaceDetailMetadata entry={catalogEntry} />
            )}
            <PluginDetailMetadataItem
              label={updatesWithBb ? "Поставка" : "Установлен"}
            >
              {installedValue}
            </PluginDetailMetadataItem>
            <PluginDetailMetadataItem label="Версия">
              <span className="font-mono">{plugin.version}</span>
            </PluginDetailMetadataItem>
          </PluginDetailMetadata>
          {hasReleaseUpdate ? (
            <div className="space-y-1">
              <p className="text-2xs font-medium text-subtle-foreground">
                Обновление
              </p>
              <PluginDetailReleaseStatus plugin={plugin} />
            </div>
          ) : null}
        </ResourceDetailReleaseSection>
        <PluginIncludes plugin={plugin} configurationPath={configurationPath} />
        {plugin.services.length > 0 ? (
          <ResourceActivitySection label="Фоновые службы">
            <PluginServices plugin={plugin} />
          </ResourceActivitySection>
        ) : null}
        {plugin.schedules.length > 0 ? (
          <ResourceActivitySection label="Запланированные задачи">
            <PluginSchedules plugin={plugin} />
          </ResourceActivitySection>
        ) : null}
        {catalogEntry === undefined ? null : (
          <PluginMoreFromAuthorSection
            entry={catalogEntry}
            catalogEntries={catalogEntries}
            onOpenPlugin={onOpenPlugin}
          />
        )}
      </ResourceDetailStack>
    </ResourceDetailPage>
  );
}
