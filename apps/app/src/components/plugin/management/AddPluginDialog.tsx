import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CURATED_PLUGIN_MARKETPLACE_NAME,
  type PluginCatalogInstallPlan,
  type PluginCatalogResolvedSource,
  type PluginInstallJob,
} from "@bb/server-contract";
import { Button } from "@bb/shared-ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import { Icon } from "@bb/shared-ui/icon";
import { Input } from "@bb/shared-ui/input";
import { pluginAdminErrorMessage } from "@/lib/plugin-admin-error";
import { applyPluginInstallJob } from "@/hooks/cache-owners/plugin-cache-owner";
import { useCatalogInstallPlan } from "@/hooks/queries/plugin-catalog-queries";
import {
  startCatalogPluginInstall,
  startPluginInstall,
} from "@/hooks/queries/plugin-install-job-queries";
import { CatalogEntryIcon, FullTrustWarning } from "./plugin-ui";

export type AddPluginInitial = {
  entryId: string;
  marketplace: string;
  pluginId: string;
  publisherLabel: string;
  displayName: string;
  icon: string | null;
  iconUrl: string | null;
  iconTinted: boolean;
  source: string;
};

function catalogInstallDescription(
  source: string,
  publisherLabel: string,
): string {
  if (source.startsWith("builtin:")) {
    return "Установить этот плагин, входящий в BB.";
  }
  if (source.startsWith("npm:")) {
    return `Установить этот плагин ${publisherLabel} из указанного пакета npm.`;
  }
  return `Установить этот плагин ${publisherLabel} из указанного репозитория.`;
}

interface AddPluginDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInstallStarted?: (job: PluginInstallJob) => void;
  initial?: AddPluginInitial | null;
}

export function AddPluginDialog({
  open,
  onOpenChange,
  onInstallStarted,
  initial,
}: AddPluginDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open ? (
          <AddPluginDialogContent
            initial={initial ?? null}
            onOpenChange={onOpenChange}
            onInstallStarted={onInstallStarted}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function buildRequest(
  initial: AddPluginInitial | null,
  sourceText: string,
):
  | { kind: "catalog"; entryId: string; marketplace: string }
  | { kind: "direct"; source: string }
  | null {
  if (initial !== null) {
    return {
      kind: "catalog",
      entryId: initial.entryId,
      marketplace: initial.marketplace,
    };
  }
  const trimmed = sourceText.trim();
  return trimmed.length === 0 ? null : { kind: "direct", source: trimmed };
}

function resolvedSourceRows(
  source: PluginCatalogResolvedSource,
): { label: string; value: string; href?: string }[] {
  if (source.kind === "npm") {
    return [
      {
        label: "пакет npm",
        value: `${source.package}@${source.range ?? source.tag ?? "latest"}`,
      },
      ...(source.registry === undefined
        ? []
        : [{ label: "registry", value: source.registry }]),
    ];
  }
  return [
    { label: "repository", value: source.url, href: source.url },
    ...(source.subdir === undefined
      ? []
      : [{ label: "subdirectory", value: source.subdir }]),
    ...(source.ref === undefined ? [] : [{ label: "ref", value: source.ref }]),
    ...(source.range === undefined
      ? []
      : [
          {
            label: "диапазон semver",
            value:
              source.tagPrefix === undefined
                ? source.range
                : `${source.range} (tags ${source.tagPrefix}vX.Y.Z)`,
          },
        ]),
    ...(source.resolvedTag === undefined
      ? []
      : [{ label: "соответствует тегу", value: source.resolvedTag }]),
    ...(source.resolvedCommit === undefined
      ? []
      : [{ label: "соответствует коммиту", value: source.resolvedCommit }]),
    ...(source.unresolvedReason === undefined
      ? []
      : [{ label: "не определён", value: source.unresolvedReason }]),
  ];
}

function ThirdPartySourceDisclosure({
  plan,
  pending,
  error,
  onRetry,
}: {
  plan: PluginCatalogInstallPlan | undefined;
  pending: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  if (pending) {
    return (
      <p className="text-2xs text-subtle-foreground" role="status">
        Проверка указанного источника…
      </p>
    );
  }
  if (error !== null && error !== undefined) {
    const status =
      error instanceof Error &&
      "status" in error &&
      typeof error.status === "number"
        ? error.status
        : null;
    const retryable =
      status === null || status === 408 || status === 429 || status >= 500;
    const message =
      status === 401 || status === 403
        ? "Доступ к источнику запрещён. Проверьте права на репозиторий."
        : status === 404
          ? "Источник не найден. Проверьте запись в каталоге."
          : retryable
            ? "Источник недоступен. Повторите попытку."
            : "Недопустимый источник. Проверьте запись в каталоге.";
    return (
      <div
        className="flex items-center gap-3 rounded-md border border-warning/20 bg-warning/5 p-3"
        role="alert"
      >
        <Icon
          name="AlertTriangle"
          className="size-4 shrink-0 text-warning-text"
          aria-hidden
        />
        <p className="min-w-0 flex-1 text-xs leading-normal text-foreground">
          {message}
        </p>
        {retryable ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 shrink-0 px-2 text-xs"
            onClick={onRetry}
          >
            Повторить
          </Button>
        ) : null}
      </div>
    );
  }
  if (plan === undefined || plan.kind !== "marketplace" || plan.official) {
    return null;
  }
  const author =
    plan.author.url === null ? null : (
      <a
        href={plan.author.url}
        target="_blank"
        rel="noreferrer"
        className="underline underline-offset-2"
      >
        {plan.author.name}
      </a>
    );
  return (
    <div className="space-y-1.5 rounded-md border border-border bg-muted/30 px-3 py-2">
      <p className="text-2xs text-subtle-foreground">
        Опубликовано в{" "}
        <span className="text-foreground">{plan.marketplaceDisplayName}</span>,
        стороннем каталоге, содержимое которого BB не проверяет.
      </p>
      <dl className="space-y-0.5">
        <div className="flex gap-2">
          <dt className="w-28 shrink-0 text-2xs text-subtle-foreground">
            автор
          </dt>
          <dd className="min-w-0 break-all font-mono text-2xs text-foreground">
            {author ?? plan.author.name}
          </dd>
        </div>
        {resolvedSourceRows(plan.resolvedSource).map((row) => (
          <div key={row.label} className="flex gap-2">
            <dt className="w-28 shrink-0 text-2xs text-subtle-foreground">
              {row.label}
            </dt>
            <dd className="min-w-0 break-all font-mono text-2xs text-foreground">
              {row.href === undefined ? (
                row.value
              ) : (
                <a
                  href={row.href}
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  {row.value}
                </a>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function AddPluginDialogContent({
  initial,
  onOpenChange,
  onInstallStarted,
}: {
  initial: AddPluginInitial | null;
  onOpenChange: (open: boolean) => void;
  onInstallStarted?: (job: PluginInstallJob) => void;
}) {
  const queryClient = useQueryClient();
  const [sourceText, setSourceText] = useState("");
  const request = buildRequest(initial, sourceText);
  const thirdParty =
    initial !== null &&
    initial.marketplace !== CURATED_PLUGIN_MARKETPLACE_NAME &&
    !initial.source.startsWith("builtin:");
  const planQuery = useCatalogInstallPlan(
    thirdParty && initial !== null
      ? { entryId: initial.entryId, marketplace: initial.marketplace }
      : null,
  );
  const plan = planQuery.data;

  const install = useMutation({
    meta: { showErrorToast: false },
    mutationFn: (body: NonNullable<typeof request>) =>
      body.kind === "catalog"
        ? startCatalogPluginInstall(fetch, {
            entryId: body.entryId,
            marketplace: body.marketplace,
            ...(thirdParty && plan?.kind === "marketplace"
              ? { confirmedSource: plan.resolvedSource }
              : {}),
          })
        : startPluginInstall(fetch, body.source),
    onSuccess: (job) => {
      applyPluginInstallJob({ queryClient, job });
      onOpenChange(false);
      onInstallStarted?.(job);
    },
  });

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {initial !== null ? `Установить ${initial.displayName}?` : "Добавить плагин"}
        </DialogTitle>
        <DialogDescription>
          {initial === null
            ? "Установите из npm, Git-репозитория или локальной папки."
            : thirdParty
              ? "Установите плагин из источника, указанного в каталоге."
              : catalogInstallDescription(
                  initial.source,
                  initial.publisherLabel,
                )}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        {initial !== null ? (
          <div className="space-y-1.5 rounded-md border border-border bg-muted/30 px-3 py-2">
            <div className="flex items-center gap-2.5">
              <CatalogEntryIcon entry={initial} className="size-6" />
              <span className="text-sm font-medium text-foreground">
                {initial.displayName}
              </span>
              <span className="ml-auto font-mono text-xs text-subtle-foreground">
                {initial.entryId}
              </span>
            </div>
            <p className="overflow-x-auto whitespace-nowrap font-mono text-2xs text-subtle-foreground">
              {initial.source}
            </p>
          </div>
        ) : (
          <div>
            <Input
              value={sourceText}
              autoFocus
              placeholder="https://github.com/owner/bb-plugin-name"
              aria-label="Источник плагина"
              className="h-8 font-mono text-xs"
              onChange={(event) => setSourceText(event.target.value)}
            />
            <p className="mt-1.5 text-2xs text-subtle-foreground">
              URL репозитория GitHub · npm:package[@version] · ./local/path
            </p>
          </div>
        )}

        {thirdParty ? (
          <ThirdPartySourceDisclosure
            plan={plan}
            pending={planQuery.isPending}
            error={planQuery.error}
            onRetry={() => void planQuery.refetch()}
          />
        ) : null}

        {install.isError ? (
          <p
            role="alert"
            className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-xs text-warning-text"
          >
            {pluginAdminErrorMessage(install.error)}
          </p>
        ) : null}

        <FullTrustWarning />
      </div>
      <DialogFooter className="gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => onOpenChange(false)}
        >
            Отмена
        </Button>
        <Button
          type="button"
          disabled={
            request === null ||
            install.isPending ||
            (thirdParty && planQuery.isPending) ||
            (thirdParty && plan === undefined)
          }
          aria-busy={install.isPending}
          onClick={() => {
            if (request !== null) install.mutate(request);
          }}
        >
          {install.isPending ? (
            <Icon name="Spinner" className="animate-spin" />
          ) : null}
          {`Установить ${initial?.displayName ?? "плагин"}`}
        </Button>
      </DialogFooter>
    </>
  );
}
