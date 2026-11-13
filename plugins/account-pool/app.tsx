import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type Modifier,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  definePluginApp,
  experimental_copyToClipboard,
  useBbNavigate,
  useRealtime,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ResourceRowDetailChevron } from "@/components/ui/resource-list";
import { Switch } from "@/components/ui/switch";
import type {
  AccountSummary,
  AccountPoolConfig,
  AccountPoolConfigSetInput,
  FamilyQuota,
  LimitWindow,
  LimitWindowSlot,
  LoginTarget,
  ModelFamily,
  PoolAvailability,
  PoolProvider,
  PoolStatus,
} from "./src/contracts.js";
import type { accountPoolRpcContract } from "./src/rpc.js";
import type { OAuthLoginStart } from "./src/oauth-login.js";
import type { CodexDeviceLoginStart } from "./src/codex-device-login.js";
import {
  DEFAULT_ACCOUNT_POOL_CONFIG,
  limitWindowSlotSchema,
  modelFamilySchema,
  statusSchema,
} from "./src/contracts.js";
import { blockingResetAt } from "./src/quota.js";
import {
  ACCOUNT_POOL_ACCOUNTS_CHANGED,
  ACCOUNT_POOL_CONFIG_CHANGED,
} from "./src/realtime.js";

type DialogState =
  | { kind: "account" | "priority" | "remove"; accountId: string }
  | { kind: "claude-login" | "codex-login"; target: LoginTarget }
  | { kind: "api-key" }
  | null;

const NEW_LOGIN: LoginTarget = { kind: "add", label: null, priority: 100 };

type ConfigField = Exclude<keyof AccountPoolConfig, "parentMode">;

const CONFIG_FIELDS: readonly ConfigField[] = [
  "anthropicUpstreamBaseUrl",
  "codexUpstreamBaseUrl",
  "switchThreshold",
];

const ACCOUNT_ACTIONS = [
  "toggle",
  "priority",
  "refresh",
  "relogin",
  "remove",
] as const;

const PROVIDERS: Array<{
  id: PoolProvider;
  title: string;
  description: string;
}> = [
  {
    id: "claude",
    title: "Claude",
    description:
      "Чаты Claude Code на всех машинах используют эти аккаунты.",
  },
  {
    id: "codex",
    title: "Codex",
    description: "Чаты Codex используют эти аккаунты ChatGPT.",
  },
];
const FAMILY_LABELS: Record<ModelFamily, string> = {
  fable: "Fable, 7 дней",
  sonnet: "Sonnet, 7 дней",
  opus: "Opus, 7 дней",
  haiku: "Haiku, 7 дней",
  other: "Другие, 7 дней",
};

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function httpUrlError(value: string): string | null {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:"
      ? null
      : "Нужен адрес HTTP или HTTPS.";
  } catch {
    return "Введите корректный адрес.";
  }
}

function configDrafts(config: AccountPoolConfig): Record<ConfigField, string> {
  return {
    anthropicUpstreamBaseUrl: config.anthropicUpstreamBaseUrl,
    codexUpstreamBaseUrl: config.codexUpstreamBaseUrl,
    switchThreshold: String(config.switchThreshold),
  };
}
function parentHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

function parentBannerBody(parent: NonNullable<PoolStatus["parent"]>): string {
  const host = parentHost(parent.baseUrl);
  if (parent.mode !== "proxy") {
    return `Этот сервер запущен из чата на ${host}. Включите переключатель, чтобы отправлять запросы Claude и Codex в его пул вместо аккаунтов ниже.`;
  }
  const served = PROVIDERS.filter(
    (provider) => parent.availability[provider.id],
  ).map((provider) => provider.title);
  if (served.length === 0) {
    return `На ${host} сейчас нет доступных аккаунтов. Запросы используют собственные учётные данные провайдера.`;
  }
  const missing = PROVIDERS.filter(
    (provider) => !parent.availability[provider.id],
  ).map((provider) => provider.title);
  const routed = `Запросы ${served.join(" и ")} направляются в пул на ${host}.`;
  return missing.length === 0
    ? `${routed} Пока переключатель включён, аккаунты этого сервера не используются.`
    : `${routed} Для ${missing.join(" и ")} там нет аккаунтов, поэтому их запросы используют собственные учётные данные.`;
}
function percent(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}
function relative(timestamp: number, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - timestamp) / 60_000));
  if (minutes < 1) return "только что";
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} ч назад` : `${Math.round(hours / 24)} дн назад`;
}
function windowShortLabel(window: LimitWindow): string {
  if (window.windowMinutes === null)
    return window.slot === "primary" ? "LIMIT" : "LIMIT 2";
  if (window.windowMinutes % 1_440 === 0)
    return `${window.windowMinutes / 1_440}D`;
  if (window.windowMinutes % 60 === 0) return `${window.windowMinutes / 60}H`;
  return `${window.windowMinutes}M`;
}
function windowLongLabel(window: LimitWindow): string {
  if (window.windowMinutes === null)
    return window.slot === "primary" ? "Лимит использования" : "Дополнительный лимит";
  if (window.windowMinutes === 7 * 24 * 60) return "Недельный";
  if (window.windowMinutes % 1_440 === 0)
    return `${window.windowMinutes / 1_440} дн.`;
  if (window.windowMinutes % 60 === 0)
    return `${window.windowMinutes / 60} ч`;
  return `${window.windowMinutes} мин`;
}
function resetLabel(timestamp: number | null): string {
  if (timestamp === null) return "";
  const minutes = Math.max(1, Math.round((timestamp - Date.now()) / 60_000));
  if (minutes < 1_440)
    return `сброс через ${minutes >= 60 ? `${Math.floor(minutes / 60)} ч ${minutes % 60} мин` : `${minutes} мин`}`;
  return `сброс ${new Intl.DateTimeFormat("ru-RU", { month: "short", day: "numeric" }).format(timestamp)}`;
}
const STATUS_CACHE_KEY = "account-pool:status";

function readCachedStatus(): PoolStatus | null {
  try {
    const raw = window.localStorage.getItem(STATUS_CACHE_KEY);
    if (raw === null) return null;
    const parsed = statusSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function writeCachedStatus(status: PoolStatus): void {
  try {
    window.localStorage.setItem(STATUS_CACHE_KEY, JSON.stringify(status));
  } catch {
    return;
  }
}

function statusPresentation(account: AccountSummary): {
  label: string;
  dot: string;
} {
  if (account.status === "held")
    return {
      label: `Ожидание${account.heldUntil === null ? "" : ` · повтор в ${new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(account.heldUntil)}`}`,
      dot: "bg-warning",
    };
  if (account.status === "exhausted") {
    const resetAt = blockingResetAt(account, null, Date.now());
    return {
      label: `Лимит исчерпан${resetAt === null ? "" : ` · ${resetLabel(resetAt)}`}`,
      dot: "bg-destructive",
    };
  }
  if (account.status === "error")
    return { label: "Ошибка", dot: "bg-destructive" };
  if (account.status === "disabled")
    return { label: "Отключён", dot: "bg-muted-foreground" };
  return { label: "Готов", dot: "bg-success" };
}
function tier(account: AccountSummary): string {
  return (
    account.subscriptionType ??
    (account.kind === "api-key" ? "Ключ API" : "OAuth")
  );
}
function secondaryEmail(account: AccountSummary): string | null {
  return account.email === null || account.email === account.label
    ? null
    : account.email;
}
function SettingsBadge({ children }: { children: ReactNode }) {
  return (
    <span className="shrink-0 rounded-sm border border-border bg-muted/40 px-1.5 py-0.5 text-2xs leading-none text-subtle-foreground">
      {children}
    </span>
  );
}

function SettingsSection({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description: string;
  action: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="@container/pool-section space-y-3">
      <div className="flex flex-col gap-3 @min-[36rem]/pool-section:flex-row @min-[36rem]/pool-section:items-start @min-[36rem]/pool-section:justify-between @min-[36rem]/pool-section:gap-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <p className="mt-0.5 text-xs leading-snug text-subtle-foreground/75">
            {description}
          </p>
        </div>
        <div className="shrink-0 self-start">{action}</div>
      </div>
      <div className="border-t border-border">{children}</div>
    </section>
  );
}

type QuotaSlot = {
  key: string;
  label: string;
  utilization: number | null;
  status: string | null;
};

const CLAUDE_WINDOW_LABELS = {
  primary: { short: "5H", long: "5 часов" },
  secondary: { short: "7D", long: "7 дней" },
} as const satisfies Record<LimitWindowSlot, { short: string; long: string }>;

type DisplayWindow = {
  key: string;
  short: string;
  long: string;
  quota: FamilyQuota | null;
};

function displayWindows(account: AccountSummary): DisplayWindow[] {
  if (account.provider === "codex")
    return account.limitWindows.map((window) => ({
      key: window.slot,
      short: windowShortLabel(window),
      long: windowLongLabel(window),
      quota: window,
    }));
  const observed =
    account.limitWindows.length === 0
      ? limitWindowSlotSchema.options.map((slot) => ({ slot, quota: null }))
      : account.limitWindows.map((window) => ({
          slot: window.slot,
          quota: window,
        }));
  return observed.map(({ slot, quota }) => ({
    key: slot,
    ...CLAUDE_WINDOW_LABELS[slot],
    quota,
  }));
}

function quotaSlots(account: AccountSummary): QuotaSlot[] {
  const windows = displayWindows(account).map((window) => ({
    key: window.key,
    label: window.short,
    utilization: window.quota?.utilization ?? null,
    status: window.quota?.status ?? null,
  }));
  if (account.provider === "codex")
    return windows.length === 0
      ? [{ key: "primary", label: "LIMIT", utilization: null, status: null }]
      : windows;
  return [
    ...windows,
    {
      key: "fable",
      label: "FABLE",
      utilization: account.familyWeekly.fable?.utilization ?? null,
      status: account.familyWeekly.fable?.status ?? null,
    },
  ];
}

function quotaToneClass(slot: QuotaSlot, threshold: number): string {
  if (
    slot.status?.toLowerCase() === "rejected" ||
    (slot.utilization !== null && slot.utilization >= 1)
  )
    return "text-destructive-text";
  if (slot.utilization !== null && slot.utilization >= threshold - 0.1)
    return "text-warning-text";
  return slot.utilization === null
    ? "text-subtle-foreground/75"
    : "text-foreground";
}

function QuotaValue({
  slot,
  threshold,
  refreshing,
}: {
  slot: QuotaSlot;
  threshold: number;
  refreshing: boolean;
}) {
  return (
    <div
      className={cn(
        "w-16 text-left tabular-nums transition-opacity @min-[32rem]/account-row:text-right",
        refreshing && "opacity-50",
      )}
    >
      <div className="text-2xs uppercase tracking-wide text-subtle-foreground/75">
        {slot.label}
      </div>
      <div
        className={cn("text-xs font-semibold", quotaToneClass(slot, threshold))}
      >
        {percent(slot.utilization)}
      </div>
    </div>
  );
}

const restrictAccountDragToVerticalAxis: Modifier = ({ transform }) => ({
  ...transform,
  x: 0,
});
const accountDragModifiers: Modifier[] = [restrictAccountDragToVerticalAxis];

function AccountRow({
  account,
  threshold,
  pending,
  refreshing,
  onAction,
  onOpen,
  reorderDisabled,
}: {
  account: AccountSummary;
  threshold: number;
  pending: boolean;
  refreshing: boolean;
  onAction: (action: (typeof ACCOUNT_ACTIONS)[number]) => void;
  onOpen: () => void;
  reorderDisabled: boolean;
}) {
  const status = statusPresentation(account);
  const slots = quotaSlots(account);
  const email = secondaryEmail(account);
  const {
    attributes,
    isDragging,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: account.id, disabled: pending || reorderDisabled });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "@container/account-row flex items-center gap-3 text-sm",
        isDragging && "relative z-10 rounded-md bg-card opacity-90 shadow-lift",
      )}
    >
      <Button
        ref={setActivatorNodeRef}
        type="button"
        variant="ghost"
        size="icon"
        className="size-8 shrink-0 touch-none text-muted-foreground enabled:cursor-grab enabled:active:cursor-grabbing"
        disabled={pending || reorderDisabled}
        aria-label={`Изменить порядок: ${account.label}`}
        {...attributes}
        {...listeners}
      >
        <Icon name="DragDropVertical" aria-hidden="true" />
      </Button>
      <div
        className={cn(
          "group relative -mx-2 flex min-w-0 flex-1 select-none items-center gap-2 rounded-md px-2 py-2.5 transition-colors hover:bg-state-hover focus-within:bg-state-hover",
          !account.enabled && "opacity-55",
        )}
      >
        <button
          type="button"
          className="grid min-w-0 flex-1 grid-cols-1 items-center gap-y-1.5 rounded-md text-left outline-none after:absolute after:inset-0 after:rounded-md after:content-[''] focus-visible:ring-2 focus-visible:ring-ring @min-[32rem]/account-row:grid-cols-[minmax(0,1fr)_auto] @min-[32rem]/account-row:gap-y-0"
          aria-label={`Открыть ${account.label}`}
          onClick={onOpen}
        >
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <span className="truncate text-sm font-medium text-foreground">
                {account.label}
              </span>
              {email === null ? null : (
                <span className="min-w-0 truncate text-xs text-subtle-foreground/75">
                  {email}
                </span>
              )}
              <SettingsBadge>{tier(account)}</SettingsBadge>
              {account.extraUsage?.status === "allowed" ? (
                <SettingsBadge>Доступен дополнительный лимит</SettingsBadge>
              ) : null}
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-subtle-foreground/75">
              <span className="inline-flex shrink-0 items-center gap-1.5">
                <span className={cn("size-1.5 rounded-full", status.dot)} />
                {status.label}
              </span>
              {account.lastUsedAt === null ? null : (
                <span>использовался {relative(account.lastUsedAt)}</span>
              )}
              {refreshing ? <span>обновление данных…</span> : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 @min-[32rem]/account-row:flex-nowrap @min-[32rem]/account-row:gap-1">
            {slots.map((slot) => (
              <QuotaValue
                key={slot.key}
                slot={slot}
                threshold={threshold}
                refreshing={refreshing}
              />
            ))}
          </div>
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="relative h-7 w-7 shrink-0 data-[state=open]:bg-state-active"
              aria-label={`Действия с ${account.label}`}
            >
              <Icon name="MoreHorizontal" className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem
              disabled={pending}
              onSelect={() => onAction("toggle")}
            >
              <Icon name={account.enabled ? "Circle" : "CircleCheck"} />
              {account.enabled ? "Отключить" : "Включить"}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={pending}
              onSelect={() => onAction("priority")}
            >
              <Icon name="ListView" />
              Задать приоритет…
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={pending}
              onSelect={() => onAction("refresh")}
            >
              <Icon name="RotateCcw" />
              Обновить данные об использовании
            </DropdownMenuItem>
            {account.kind === "oauth" ? (
              <DropdownMenuItem
                disabled={pending}
                onSelect={() => onAction("relogin")}
              >
                <Icon name="UserRound" />
                Войти снова…
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              disabled={pending}
              onSelect={() => onAction("remove")}
            >
              <Icon name="Trash2" />
              Удалить
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          type="button"
          aria-label={`Открыть сведения об аккаунте ${account.label}`}
          className="relative"
          onClick={onOpen}
        >
          <ResourceRowDetailChevron />
        </button>
      </div>
    </div>
  );
}

function AddAccountMenu({
  provider,
  onChoose,
}: {
  provider: PoolProvider;
  onChoose: (choice: "login" | "api-key") => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline">
          <Icon name="Plus" className="size-3.5" />
          Добавить аккаунт
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuItem
          className="items-start py-2"
          onSelect={() => onChoose("login")}
        >
          <Icon name="UserRound" className="mt-0.5" />
          <span>
            <span className="block">
              Войти в {provider === "claude" ? "Claude" : "Codex"}
            </span>
            <span className="block text-xs text-muted-foreground">
              {provider === "claude"
                ? "Откроется claude.ai; затем вставьте сюда код"
                : "Откроется ChatGPT с кодом устройства"}
            </span>
          </span>
        </DropdownMenuItem>
        {provider === "claude" ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="items-start py-2"
              onSelect={() => onChoose("api-key")}
            >
              <Icon name="Lock" className="mt-0.5" />
              <span>
                <span className="block">Добавить ключ API…</span>
                <span className="block text-xs text-muted-foreground">
                  Резервный платный вариант; не используется первым
                </span>
              </span>
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function StepIndicator({ step }: { step: 1 | 2 | 3 }) {
  return (
    <div className="flex gap-1.5" aria-label={`Шаг ${step} из 3`}>
      {[1, 2, 3].map((value) => (
        <span
          key={value}
          className={cn(
            "h-1 flex-1 rounded-full",
            value <= step ? "bg-primary" : "bg-muted",
          )}
        />
      ))}
    </div>
  );
}
function QuotaDetail({
  label,
  quota,
  threshold,
}: {
  label: string;
  quota: FamilyQuota | null;
  threshold: number;
}) {
  const utilization = quota?.utilization ?? null;
  return (
    <div className="grid grid-cols-[7rem_1fr] items-center gap-3 text-sm">
      <div className="text-muted-foreground">{label}</div>
      <div className="min-w-0">
        <div className="mb-1 h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              "h-full rounded-full",
              utilization !== null && utilization >= 1
                ? "bg-destructive"
                : utilization !== null && utilization >= threshold - 0.1
                  ? "bg-warning"
                  : "bg-primary",
            )}
            style={{
              width: `${Math.min(100, Math.max(0, (utilization ?? 0) * 100))}%`,
            }}
          />
        </div>
        <div className="text-xs text-muted-foreground">
          {percent(utilization)}
          {quota?.resetAt === null || quota === null
            ? ""
            : ` · ${resetLabel(quota.resetAt)}`}{" "}
          · другие аккаунты предпочтительны от {Math.round(threshold * 100)}%
        </div>
      </div>
    </div>
  );
}

type CopyState = "idle" | "copied" | "manual";

function useCopyToClipboard(text: string, selectFallback: () => void) {
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    },
    [],
  );
  useEffect(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    setCopyState("idle");
  }, [text]);

  const copy = useCallback(() => {
    void experimental_copyToClipboard({ text }).then((copied) => {
      if (!copied) {
        selectFallback();
        setCopyState("manual");
        return;
      }
      setCopyState("copied");
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopyState("idle"), 1500);
    });
  }, [text, selectFallback]);

  return { copyState, copy };
}

function UserCodeBlock({ userCode }: { userCode: string }) {
  const codeRef = useRef<HTMLSpanElement>(null);
  const selectCode = useCallback(() => {
    const element = codeRef.current;
    if (element === null) return;
    const selection = window.getSelection();
    if (selection === null) return;
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
  }, []);
  const { copyState, copy } = useCopyToClipboard(userCode, selectCode);

  return (
    <div className="rounded-lg border border-border bg-surface-recessed px-4 py-4">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center">
        <span
          ref={codeRef}
          className="col-start-2 select-all text-center font-mono text-2xl font-semibold tracking-widest"
          aria-label="Код пользователя Codex"
        >
          {userCode}
        </span>
        <Button
          type="button"
          variant="ghost"
          aria-label="Скопировать код входа Codex"
          className="col-start-3 size-9 justify-self-start text-muted-foreground hover:text-foreground max-sm:pointer-coarse:size-11"
          onClick={copy}
        >
          <Icon name={copyState === "copied" ? "Check" : "Copy"} />
        </Button>
      </div>
      <span aria-live="polite" className="sr-only">
        {copyState === "copied"
          ? "Код входа скопирован"
          : copyState === "manual"
            ? "Браузер запретил копирование. Код выделен; скопируйте его вручную."
            : ""}
      </span>
    </div>
  );
}

function AuthorizationUrlRow({
  name,
  url,
  openUrl,
}: {
  name: string;
  url: string;
  openUrl: (url: string) => boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const selectUrl = useCallback(() => {
    inputRef.current?.select();
  }, []);
  const { copyState, copy } = useCopyToClipboard(url, selectUrl);

  return (
    <div>
      <div className="flex gap-2">
        <Input
          ref={inputRef}
          readOnly
          value={url}
          aria-label={`Адрес авторизации ${name}`}
        />
        <Button
          variant="outline"
          className="shrink-0"
          aria-label={`Скопировать адрес авторизации ${name}`}
          onClick={copy}
        >
          {copyState === "copied" ? "Скопировано" : "Копировать"}
        </Button>
        <Button className="shrink-0" onClick={() => openUrl(url)}>
          Открыть
        </Button>
      </div>
      <span aria-live="polite" className="sr-only">
        {copyState === "copied"
          ? "Адрес авторизации скопирован"
          : copyState === "manual"
            ? "Браузер запретил копирование. Адрес выделен; скопируйте его вручную."
            : ""}
      </span>
    </div>
  );
}

function DialogFrame({
  title,
  children,
  footer,
  className,
}: {
  title: string;
  children: ReactNode;
  footer: ReactNode;
  className?: string;
}) {
  return (
    <DialogContent
      hideCloseButton
      className={cn(
        "max-h-[85vh] grid-rows-[auto_minmax(0,1fr)_auto]",
        className,
      )}
    >
      <DialogHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <DialogTitle>{title}</DialogTitle>
        <DialogClose className="-mr-1 shrink-0 cursor-pointer rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2">
          <Icon name="X" className="size-4" />
          <span className="sr-only">Закрыть</span>
        </DialogClose>
      </DialogHeader>
      <div className="min-h-0 space-y-5 overflow-y-auto">{children}</div>
      {footer === null ? null : (
        <DialogFooter className="flex-row items-center gap-2 sm:space-x-0">
          {footer}
        </DialogFooter>
      )}
    </DialogContent>
  );
}

function ConfigFieldRow({
  label,
  description,
  error,
  children,
}: {
  label: string;
  description: string;
  error: string | null;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <div className="text-sm text-foreground">{label}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {description}
        </div>
      </div>
      <div className="w-80 max-w-[50%] shrink-0">
        {children}
        {error === null ? null : (
          <p className="mt-1 text-xs text-destructive-text" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

function AccountPoolSettings() {
  const rpc = useRpc<typeof accountPoolRpcContract>();
  const navigate = useBbNavigate();
  const [status, setStatus] = useState<PoolStatus | null>(readCachedStatus);
  const [statusIsCached, setStatusIsCached] = useState(status !== null);
  const [config, setConfig] = useState<AccountPoolConfig | null>(null);
  const [drafts, setDrafts] = useState<Record<ConfigField, string>>({
    anthropicUpstreamBaseUrl: "",
    codexUpstreamBaseUrl: "",
    switchThreshold: "",
  });
  const [configErrors, setConfigErrors] = useState<
    Record<ConfigField, string | null>
  >({
    anthropicUpstreamBaseUrl: null,
    codexUpstreamBaseUrl: null,
    switchThreshold: null,
  });
  const [dialog, setDialog] = useState<DialogState>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<ReadonlyMap<string, boolean | null>>(
    () => new Map(),
  );
  const configSaving = CONFIG_FIELDS.some((field) =>
    pending.has(`config-${field}`),
  );
  const [optimisticOrder, setOptimisticOrder] = useState<{
    provider: PoolProvider;
    ids: string[];
  } | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const [loginStep, setLoginStep] = useState<OAuthLoginStart | null>(null);
  const [codexStep, setCodexStep] = useState<CodexDeviceLoginStart | null>(
    null,
  );
  const [loginDone, setLoginDone] = useState<string | null>(null);
  const [pastedCode, setPastedCode] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [priority, setPriority] = useState("100");
  const [countdown, setCountdown] = useState(0);
  const mounted = useRef(true);
  const threshold =
    config?.switchThreshold ?? DEFAULT_ACCOUNT_POOL_CONFIG.switchThreshold;
  const applyConfig = useCallback((next: AccountPoolConfig) => {
    setConfig(next);
    setDrafts(configDrafts(next));
  }, []);
  const refresh = useCallback(async () => {
    try {
      const next = await rpc.call("status.get", null);
      writeCachedStatus(next);
      if (!mounted.current) return;
      setStatus(next);
      setStatusIsCached(false);
    } catch (loadError) {
      if (mounted.current) setError(errorText(loadError));
    }
  }, [rpc]);
  const refreshConfig = useCallback(async () => {
    try {
      const next = await rpc.call("config.get", null);
      if (mounted.current) applyConfig(next);
    } catch (loadError) {
      if (mounted.current) setError(errorText(loadError));
    }
  }, [applyConfig, rpc]);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    void refreshConfig();
    return () => {
      mounted.current = false;
    };
  }, [refresh, refreshConfig]);
  useRealtime(ACCOUNT_POOL_ACCOUNTS_CHANGED, () => {
    void refresh();
  });
  useRealtime(ACCOUNT_POOL_CONFIG_CHANGED, () => {
    void refreshConfig();
  });
  useEffect(() => {
    if (codexStep === null || loginDone !== null) return;
    const update = () =>
      setCountdown(
        Math.max(0, Math.ceil((codexStep.expiresAt - Date.now()) / 1_000)),
      );
    update();
    const interval = window.setInterval(update, 1_000);
    return () => window.clearInterval(interval);
  }, [codexStep, loginDone]);
  useEffect(() => {
    if (codexStep === null || loginDone !== null) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      try {
        const result = await rpc.call("codexLogin.poll", {
          sessionId: codexStep.sessionId,
        });
        if (cancelled) return;
        if (result.status === "complete") {
          setLoginDone(result.account.label);
          setCodexStep(null);
          await refresh();
        } else if (result.status === "error") {
          setCodexStep(null);
          setError(result.message);
        } else timer = setTimeout(() => void poll(), codexStep.intervalMs);
      } catch (pollError) {
        if (!cancelled) setError(errorText(pollError));
      }
    };
    timer = setTimeout(() => void poll(), codexStep.intervalMs);
    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [codexStep, loginDone, refresh, rpc]);
  const accounts = status?.accounts ?? [];
  const loginTarget =
    dialog?.kind === "claude-login" || dialog?.kind === "codex-login"
      ? dialog.target
      : null;
  const reloginId =
    loginTarget?.kind === "relogin" ? loginTarget.accountId : null;
  const reloginAccount =
    accounts.find((account) => account.id === reloginId) ?? null;
  const selectedAccount =
    dialog?.kind === "account" ||
    dialog?.kind === "priority" ||
    dialog?.kind === "remove"
      ? (accounts.find((account) => account.id === dialog.accountId) ?? null)
      : null;
  function markPending(key: string, target: boolean | null): void {
    setPending((current) => new Map(current).set(key, target));
  }
  function clearPending(key: string): void {
    setPending((current) => {
      const next = new Map(current);
      next.delete(key);
      return next;
    });
  }
  async function run(
    key: string,
    action: () => Promise<void>,
    target: boolean | null = null,
  ): Promise<void> {
    if (pending.has(key)) return;
    markPending(key, target);
    setError(null);
    try {
      await action();
      await refresh();
    } catch (actionError) {
      setError(errorText(actionError));
    } finally {
      clearPending(key);
    }
  }
  function switchValue(key: string, stored: boolean): boolean {
    return pending.get(key) ?? stored;
  }
  function accountPending(accountId: string): boolean {
    return ACCOUNT_ACTIONS.some((action) =>
      pending.has(`${action}-${accountId}`),
    );
  }
  function updateConfigDraft(field: ConfigField, value: string): void {
    setDrafts((current) => ({ ...current, [field]: value }));
    setConfigErrors((current) => ({ ...current, [field]: null }));
  }
  async function saveConfigField(field: ConfigField): Promise<void> {
    if (config === null || configSaving) return;
    let update: AccountPoolConfigSetInput;
    if (field === "switchThreshold") {
      const raw = drafts.switchThreshold.trim();
      const value = Number(raw);
      if (
        raw.length === 0 ||
        !Number.isFinite(value) ||
        value <= 0 ||
        value > 1
      ) {
        setConfigErrors((current) => ({
          ...current,
          switchThreshold: "Must be greater than 0 and at most 1.",
        }));
        return;
      }
      if (value === config.switchThreshold) return;
      update = { switchThreshold: value };
    } else {
      const value = drafts[field].trim();
      const validationError = httpUrlError(value);
      if (validationError !== null) {
        setConfigErrors((current) => ({
          ...current,
          [field]: validationError,
        }));
        return;
      }
      if (value === config[field]) return;
      update =
        field === "anthropicUpstreamBaseUrl"
          ? { anthropicUpstreamBaseUrl: value }
          : { codexUpstreamBaseUrl: value };
    }
    markPending(`config-${field}`, null);
    setConfigErrors((current) => ({ ...current, [field]: null }));
    try {
      applyConfig(await rpc.call("config.set", update));
    } catch (saveError) {
      setConfigErrors((current) => ({
        ...current,
        [field]: errorText(saveError),
      }));
    } finally {
      clearPending(`config-${field}`);
    }
  }
  async function startClaude(target: LoginTarget): Promise<void> {
    setDialog({ kind: "claude-login", target });
    setLoginDone(null);
    await run("claude-login", async () => {
      const started = await rpc.call("login.start", target);
      setLoginStep(started);
      setPastedCode("");
    });
  }
  async function startCodex(target: LoginTarget): Promise<void> {
    setDialog({ kind: "codex-login", target });
    setLoginDone(null);
    await run("codex-login", async () => {
      setCodexStep(await rpc.call("codexLogin.start", target));
    });
  }
  async function startLogin(
    provider: PoolProvider,
    target: LoginTarget,
  ): Promise<void> {
    if (provider === "claude") await startClaude(target);
    else await startCodex(target);
  }
  async function chooseAdd(
    provider: PoolProvider,
    choice: "login" | "api-key",
  ): Promise<void> {
    if (choice === "login") {
      await startLogin(provider, NEW_LOGIN);
      return;
    }
    setDialog({ kind: "api-key" });
  }
  async function accountAction(
    account: AccountSummary,
    action: (typeof ACCOUNT_ACTIONS)[number],
  ): Promise<void> {
    if (action === "priority") {
      setPriority(String(account.priority));
      setDialog({ kind: "priority", accountId: account.id });
      return;
    }
    if (action === "remove") {
      setDialog({ kind: "remove", accountId: account.id });
      return;
    }
    if (action === "relogin") {
      await startLogin(account.provider, {
        kind: "relogin",
        accountId: account.id,
      });
      return;
    }
    await run(`${action}-${account.id}`, async () => {
      if (action === "toggle")
        await rpc.call(account.enabled ? "account.disable" : "account.enable", {
          id: account.id,
        });
      if (action === "refresh")
        await rpc.call("account.refreshUsage", { accountId: account.id });
    });
  }
  async function reorderAccounts(
    provider: PoolProvider,
    event: DragEndEvent,
  ): Promise<void> {
    if (pending.has(`order-${provider}`) || event.over === null) return;
    const ids = accounts
      .filter((account) => account.provider === provider)
      .map((account) => account.id);
    const from = ids.findIndex((id) => id === event.active.id);
    const to = ids.findIndex((id) => id === event.over?.id);
    if (from < 0 || to < 0 || from === to) return;
    const accountIds = arrayMove(ids, from, to);
    setOptimisticOrder({ provider, ids: accountIds });
    try {
      await run(`order-${provider}`, async () => {
        await rpc.call("account.reorder", { provider, accountIds });
      });
    } finally {
      setOptimisticOrder(null);
    }
  }
  function closeDialog(): void {
    if (dialog?.kind === "codex-login" && codexStep !== null)
      void rpc.call("codexLogin.cancel", { sessionId: codexStep.sessionId });
    setDialog(null);
    setLoginStep(null);
    setCodexStep(null);
    setLoginDone(null);
    setError(null);
  }
  const hubHosts =
    status?.hosts.map((host) => host.hostName ?? host.hostId).join(", ") ||
    "нет машин";
  const parent = status?.parent ?? null;
  const proxying = parent !== null && parent.mode === "proxy";
  return (
    <div className="w-full space-y-6">
      {parent === null ? null : (
        <div className="rounded-lg border border-border px-4 py-3">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-foreground">
                {proxying
                  ? "Используется родительский пул аккаунтов"
                  : "Доступен родительский пул аккаунтов"}
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {parentBannerBody(parent)}
              </p>
            </div>
            <Switch
              checked={switchValue("parent-mode", proxying)}
              aria-label="Использовать родительский пул аккаунтов"
              onCheckedChange={(enabled) =>
                void run(
                  "parent-mode",
                  async () => {
                    await rpc.call("config.set", {
                      parentMode: enabled ? "proxy" : "isolate",
                    });
                  },
                  enabled,
                )
              }
            />
          </div>
        </div>
      )}
      <div
        className={proxying ? "space-y-6 opacity-50" : "space-y-6"}
        inert={proxying ? true : undefined}
      >
        <p className="text-xs text-subtle-foreground/75">
          Центр {status?.accepting ? "принимает запросы" : "не принимает запросы"} ·{" "}
          {status?.inFlight ?? 0} в обработке · используется на {hubHosts}
          {statusIsCached ? " · обновление…" : null}
        </p>
        {error === null ? null : (
          <div
            role="alert"
            className="rounded-md border border-destructive/40 bg-surface-destructive px-3 py-2 text-sm text-destructive-text"
          >
            {error}
          </div>
        )}
        {status !== null && !statusIsCached && accounts.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-5 py-6 text-center">
            <h2 className="text-sm font-semibold text-foreground">
              В пуле нет аккаунтов
            </h2>
            <p className="mx-auto mt-1 max-w-lg text-xs leading-relaxed text-muted-foreground">
              Добавьте аккаунт Claude или Codex, и чаты на всех машинах начнут
              использовать его. До этого сохраняется вход на вашей машине.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Button size="sm" onClick={() => void startClaude(NEW_LOGIN)}>
                Войти в Claude
              </Button>
              <Button size="sm" onClick={() => void startCodex(NEW_LOGIN)}>
                Войти в Codex
              </Button>
            </div>
          </div>
        ) : null}
        {PROVIDERS.map((provider) => {
          const serverAccounts = accounts.filter(
            (account) => account.provider === provider.id,
          );
          const order =
            optimisticOrder?.provider === provider.id
              ? optimisticOrder.ids
              : null;
          const providerAccounts =
            order !== null &&
            order.length === serverAccounts.length &&
            serverAccounts.every((account) => order.includes(account.id))
              ? order.flatMap((id) =>
                  serverAccounts.filter((account) => account.id === id),
                )
              : serverAccounts;
          return (
            <SettingsSection
              key={provider.id}
              title={provider.title}
              description={provider.description}
              action={
                <div className="flex items-center gap-2">
                  <Switch
                    checked={switchValue(
                      `routing-${provider.id}`,
                      status?.routing[provider.id] ?? true,
                    )}
                    aria-label={`Направлять чаты ${provider.title} через пул`}
                    onCheckedChange={(enabled) =>
                      void run(
                        `routing-${provider.id}`,
                        async () => {
                          await rpc.call("routing.set", {
                            provider: provider.id,
                            enabled,
                          });
                        },
                        enabled,
                      )
                    }
                  />
                  <AddAccountMenu
                    provider={provider.id}
                    onChoose={(choice) => void chooseAdd(provider.id, choice)}
                  />
                </div>
              }
            >
              {status === null ? (
                <p className="py-2.5 text-sm text-muted-foreground">Загрузка…</p>
              ) : providerAccounts.length === 0 ? (
                <p className="py-2.5 text-sm text-subtle-foreground">
                  Аккаунтов пока нет.
                </p>
              ) : (
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  modifiers={accountDragModifiers}
                  onDragEnd={(event) =>
                    void reorderAccounts(provider.id, event)
                  }
                >
                  <SortableContext
                    items={providerAccounts.map((account) => account.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className="divide-y divide-border">
                      {providerAccounts.map((account) => (
                        <AccountRow
                          key={account.id}
                          account={account}
                          threshold={threshold}
                          pending={accountPending(account.id)}
                          refreshing={
                            statusIsCached ||
                            pending.has(`refresh-${account.id}`)
                          }
                          reorderDisabled={
                            providerAccounts.length < 2 ||
                            pending.has(`order-${provider.id}`)
                          }
                          onAction={(action) =>
                            void accountAction(account, action)
                          }
                          onOpen={() =>
                            setDialog({
                              kind: "account",
                              accountId: account.id,
                            })
                          }
                        />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
              )}
            </SettingsSection>
          );
        })}
        <Collapsible className="rounded-lg border border-border px-4">
          <CollapsibleTrigger className="flex w-full items-center gap-2 py-2.5 text-sm font-medium text-foreground">
            <Icon
              name="ChevronRight"
              className="size-4 transition-transform [[data-state=open]>&]:rotate-90"
            />
            Дополнительно
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="divide-y divide-border border-t border-border">
              <ConfigFieldRow
                label="Базовый адрес сервера Anthropic"
                description="Переопределение адреса Anthropic для тестирования."
                error={configErrors.anthropicUpstreamBaseUrl}
              >
                <Input
                  aria-label="Базовый адрес сервера Anthropic"
                  aria-invalid={
                    configErrors.anthropicUpstreamBaseUrl === null
                      ? undefined
                      : true
                  }
                  disabled={config === null || configSaving}
                  value={drafts.anthropicUpstreamBaseUrl}
                  onChange={(event) =>
                    updateConfigDraft(
                      "anthropicUpstreamBaseUrl",
                      event.target.value,
                    )
                  }
                  onBlur={() =>
                    void saveConfigField("anthropicUpstreamBaseUrl")
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                  }}
                />
              </ConfigFieldRow>
              <ConfigFieldRow
                label="Базовый адрес сервера Codex"
                description="Переопределение адреса ChatGPT Codex для тестирования."
                error={configErrors.codexUpstreamBaseUrl}
              >
                <Input
                  aria-label="Базовый адрес сервера Codex"
                  aria-invalid={
                    configErrors.codexUpstreamBaseUrl === null
                      ? undefined
                      : true
                  }
                  disabled={config === null || configSaving}
                  value={drafts.codexUpstreamBaseUrl}
                  onChange={(event) =>
                    updateConfigDraft(
                      "codexUpstreamBaseUrl",
                      event.target.value,
                    )
                  }
                  onBlur={() => void saveConfigField("codexUpstreamBaseUrl")}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                  }}
                />
              </ConfigFieldRow>
              <ConfigFieldRow
                label="Порог переключения по лимиту"
                description="Предпочитать аккаунты с использованием ниже этого порога. Аккаунты выше порога продолжают работать, пока провайдер принимает запросы."
                error={configErrors.switchThreshold}
              >
                <Input
                  type="number"
                  min="0.01"
                  max="1"
                  step="0.01"
                  aria-label="Порог переключения по лимиту"
                  aria-invalid={
                    configErrors.switchThreshold === null ? undefined : true
                  }
                  disabled={config === null || configSaving}
                  value={drafts.switchThreshold}
                  onChange={(event) =>
                    updateConfigDraft("switchThreshold", event.target.value)
                  }
                  onBlur={() => void saveConfigField("switchThreshold")}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                  }}
                />
              </ConfigFieldRow>
              <div className="flex items-start justify-between gap-4">
                <div className="py-2.5">
                  <div className="text-sm text-foreground">Токены машин</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {hubHosts}
                  </div>
                </div>
                <div className="flex flex-wrap justify-end gap-2 py-2.5">
                  {status?.hosts.map((host) => (
                    <Button
                      key={host.hostId}
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        void run(`rotate-${host.hostId}`, async () => {
                          await rpc.call("token.rotate", {
                            machine: host.hostId,
                          });
                        })
                      }
                    >
                      Обновить токен: {host.hostName ?? host.hostId}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>
      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
      >
        {dialog?.kind === "account" && selectedAccount !== null ? (
          <AccountDialog
            account={selectedAccount}
            threshold={threshold}
            act={(action) => void accountAction(selectedAccount, action)}
          />
        ) : null}
        {dialog?.kind === "priority" && selectedAccount !== null ? (
          <DialogFrame
            title="Задать приоритет"
            footer={
              <>
                <span className="flex-1" />
                <Button variant="outline" onClick={closeDialog}>
                  Отмена
                </Button>
                <Button
                  disabled={
                    !Number.isInteger(Number(priority)) ||
                    pending.has(`priority-${selectedAccount.id}`)
                  }
                  onClick={() =>
                    void run(`priority-${selectedAccount.id}`, async () => {
                      await rpc.call("account.setPriority", {
                        accountId: selectedAccount.id,
                        priority: Number(priority),
                      });
                      setDialog(null);
                    })
                  }
                >
                  Сохранить
                </Button>
              </>
            }
          >
            <p className="text-sm text-muted-foreground">
              Меньшие числа используются раньше при переключении. При равенстве
              действует порядок добавления аккаунтов. Существующие чаты сохраняют привязку.
            </p>
            <Input
              type="number"
              aria-label="Приоритет аккаунта"
              value={priority}
              onChange={(event) => setPriority(event.target.value)}
            />
          </DialogFrame>
        ) : null}
        {dialog?.kind === "api-key" ? (
          <DialogFrame
            title="Добавить ключ API Anthropic"
            footer={
              <>
                <span className="flex-1" />
                <Button variant="outline" onClick={closeDialog}>
                  Отмена
                </Button>
                <Button
                  disabled={
                    apiKey.trim().length === 0 || pending.has("api-key")
                  }
                  onClick={() =>
                    void run("api-key", async () => {
                      await rpc.call("account.add", {
                        provider: "claude",
                        apiKey: apiKey.trim(),
                        label: null,
                        priority: 100,
                      });
                      setApiKey("");
                      setDialog(null);
                    })
                  }
                >
                  Добавить ключ API
                </Button>
              </>
            }
          >
            <p className="text-sm text-muted-foreground">
              Резервный платный ключ хранится в защищённом каталоге секретов пула аккаунтов.
            </p>
            <Input
              type="password"
              autoComplete="off"
              aria-label="Ключ API Anthropic"
              placeholder="sk-ant-…"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
            />
          </DialogFrame>
        ) : null}
        {dialog?.kind === "remove" && selectedAccount !== null ? (
          <DialogFrame
            title={`Удалить ${selectedAccount.label}?`}
            footer={
              <>
                <span className="flex-1" />
                <Button variant="outline" onClick={closeDialog}>
                  Отмена
                </Button>
                <Button
                  variant="destructive"
                  disabled={pending.has(`remove-${selectedAccount.id}`)}
                  onClick={() =>
                    void run(`remove-${selectedAccount.id}`, async () => {
                      await rpc.call("account.remove", {
                        id: selectedAccount.id,
                      });
                      setDialog(null);
                    })
                  }
                >
                  Удалить
                </Button>
              </>
            }
          >
            <p className="text-sm text-muted-foreground">
              Это удалит файл секрета аккаунта. Если в пуле нет других аккаунтов,
              чаты снова используют вход на своей машине.
            </p>
          </DialogFrame>
        ) : null}
        {dialog?.kind === "claude-login" ? (
          <LoginDialog
            provider="claude"
            relogin={reloginAccount}
            loginStep={loginStep}
            codexStep={null}
            loginDone={loginDone}
            pending={
              pending.has("claude-login") || pending.has("complete-claude")
            }
            pastedCode={pastedCode}
            countdown={0}
            error={error}
            close={closeDialog}
            openUrl={navigate.openUrl}
            setPastedCode={setPastedCode}
            complete={() =>
              void run("complete-claude", async () => {
                if (loginStep === null) return;
                const added = await rpc.call("login.complete", {
                  sessionId: loginStep.sessionId,
                  pasted: pastedCode,
                });
                setLoginDone(added.label);
                setLoginStep(null);
              })
            }
            restart={() => void startClaude(dialog.target)}
            addAnother={() => void startClaude(NEW_LOGIN)}
          />
        ) : null}
        {dialog?.kind === "codex-login" ? (
          <LoginDialog
            provider="codex"
            relogin={reloginAccount}
            loginStep={null}
            codexStep={codexStep}
            loginDone={loginDone}
            pending={pending.has("codex-login")}
            pastedCode=""
            countdown={countdown}
            error={error}
            close={closeDialog}
            openUrl={navigate.openUrl}
            setPastedCode={() => {}}
            complete={() => {}}
            restart={() => void startCodex(dialog.target)}
            addAnother={() => void startCodex(NEW_LOGIN)}
          />
        ) : null}
      </Dialog>
    </div>
  );
}

function AccountDialog({
  account,
  threshold,
  act,
}: {
  account: AccountSummary;
  threshold: number;
  act: (action: "toggle" | "refresh" | "relogin" | "remove") => void;
}) {
  const windows = displayWindows(account);
  const providerId =
    account.provider === "claude"
      ? account.accountUuid
      : account.codexAccountId;
  return (
    <DialogFrame
      title={account.label}
      className="sm:max-w-xl"
      footer={
        <>
          <Button size="sm" variant="outline" onClick={() => act("toggle")}>
            {account.enabled ? "Отключить" : "Включить"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => act("refresh")}>
            Обновить данные об использовании
          </Button>
          {account.kind === "oauth" ? (
            <Button size="sm" variant="outline" onClick={() => act("relogin")}>
              Войти снова
            </Button>
          ) : null}
          <span className="flex-1" />
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive-text"
            onClick={() => act("remove")}
          >
            Удалить
          </Button>
        </>
      }
    >
      <div className="flex items-center gap-2">
        <SettingsBadge>{tier(account)}</SettingsBadge>
        <SettingsBadge>{statusPresentation(account).label}</SettingsBadge>
      </div>
      <div className="space-y-4">
        {windows.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            Данные о лимитах пока не получены.
          </div>
        ) : (
          windows.map((window) => (
            <QuotaDetail
              key={window.key}
              label={window.long}
              quota={window.quota}
              threshold={threshold}
            />
          ))
        )}
        {modelFamilySchema.options.flatMap((family) =>
          account.familyWeekly[family] === null
            ? []
            : [
                <QuotaDetail
                  key={family}
                  label={FAMILY_LABELS[family]}
                  quota={account.familyWeekly[family]}
                  threshold={threshold}
                />,
              ],
        )}
      </div>
      <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2 border-t border-border pt-4 text-sm">
        {account.email === null ? null : (
          <>
            <dt className="text-muted-foreground">Электронная почта</dt>
            <dd className="break-all">{account.email}</dd>
          </>
        )}
        <dt className="text-muted-foreground">Тип</dt>
        <dd>
          {account.kind === "oauth"
            ? `OAuth · ${account.provider === "claude" ? "claude.ai" : "ChatGPT"}`
            : "Ключ API"}
        </dd>
        <dt className="text-muted-foreground">Приоритет</dt>
        <dd>{account.priority}</dd>
        <dt className="text-muted-foreground">Последнее использование</dt>
        <dd>
          {account.lastUsedAt === null
            ? "Никогда"
            : `${relative(account.lastUsedAt)}${account.lastUsedHostName === null ? "" : ` · ${account.lastUsedHostName}`}`}
        </dd>
        <dt className="text-muted-foreground">Обновление данных</dt>
        <dd>
          {account.observedAt === null ? "Никогда" : relative(account.observedAt)}
        </dd>
        {providerId === null || providerId === undefined ? null : (
          <>
            <dt className="text-muted-foreground">ID аккаунта</dt>
            <dd className="font-mono text-xs">{`${providerId.slice(0, 4)}…${providerId.slice(-4)}`}</dd>
          </>
        )}
      </dl>
    </DialogFrame>
  );
}

function LoginError({
  message,
  restart,
}: {
  message: string;
  restart: () => void;
}) {
  return (
    <p className="text-sm text-destructive-text">
      {message.replace(/\s*Start again\.$/u, "")}{" "}
      <Button
        type="button"
        variant="link"
        size="sm"
        className="h-auto p-0 align-baseline text-sm text-foreground underline underline-offset-4"
        onClick={restart}
      >
        Начать заново
      </Button>
    </p>
  );
}

function LoginDialog({
  provider,
  relogin,
  loginStep,
  codexStep,
  loginDone,
  pending,
  pastedCode,
  countdown,
  error,
  close,
  openUrl,
  setPastedCode,
  complete,
  restart,
  addAnother,
}: {
  provider: PoolProvider;
  relogin: AccountSummary | null;
  loginStep: OAuthLoginStart | null;
  codexStep: CodexDeviceLoginStart | null;
  loginDone: string | null;
  pending: boolean;
  pastedCode: string;
  countdown: number;
  error: string | null;
  close: () => void;
  openUrl: (url: string) => boolean;
  setPastedCode: (value: string) => void;
  complete: () => void;
  restart: () => void;
  addAnother: () => void;
}) {
  const name = provider === "claude" ? "Claude" : "Codex";
  const url =
    provider === "claude"
      ? loginStep?.authorizeUrl
      : codexStep?.verificationUri;
  return (
    <DialogFrame
      title={
        relogin === null
          ? `Вход в ${name}`
          : `Повторный вход: ${relogin.label}`
      }
      className="sm:max-w-xl"
      footer={
        loginDone !== null ? (
          <>
            <span className="flex-1" />
            {relogin === null ? (
              <Button variant="outline" onClick={addAnother}>
                Добавить ещё
              </Button>
            ) : null}
            <Button onClick={close}>Готово</Button>
          </>
        ) : provider === "claude" ? (
          <>
            <span className="flex-1" />
            <Button
              disabled={
                loginStep === null ||
                pastedCode.trim().length === 0 ||
                pending ||
                error !== null
              }
              onClick={complete}
            >
              Завершить
            </Button>
          </>
        ) : null
      }
    >
      <StepIndicator step={loginDone === null ? 2 : 3} />
      {loginDone !== null ? (
        relogin === null ? (
          <div>
            <h3 className="text-base font-semibold">Подключён аккаунт {loginDone}</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Чаты {name} на всех машинах теперь используют этот аккаунт.
              Данные об использовании обновляются в фоне.
            </p>
          </div>
        ) : (
          <div>
            <h3 className="text-base font-semibold">
              Повторный вход в {loginDone} выполнен
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Приоритет, состояние и привязанные чаты сохранены.
            </p>
          </div>
        )
      ) : url === undefined ? (
        provider === "codex" && error !== null ? (
          <LoginError message={error} restart={restart} />
        ) : (
          <p className="text-sm text-muted-foreground">Начало входа…</p>
        )
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {relogin === null
              ? null
              : `Войдите как ${relogin.email ?? relogin.label}. `}
            {provider === "claude"
              ? "Войдите на claude.ai и вставьте код с последней страницы."
              : "Откройте страницу подтверждения, войдите в ChatGPT и введите этот код."}
          </p>
          {codexStep === null ? null : (
            <UserCodeBlock userCode={codexStep.userCode} />
          )}
          <AuthorizationUrlRow name={name} url={url} openUrl={openUrl} />
          {provider === "claude" ? (
            <>
              <Input
                aria-label="Код авторизации Claude"
                placeholder="Вставьте сюда code#state"
                value={pastedCode}
                onChange={(event) => setPastedCode(event.target.value)}
              />
              {error === null ? null : (
                <LoginError message={error} restart={restart} />
              )}
            </>
          ) : (
            <p className="text-center text-sm text-muted-foreground">
              Ожидание подтверждения… код истечёт через{" "}
              {Math.floor(countdown / 60)}:
              {String(countdown % 60).padStart(2, "0")}
            </p>
          )}
        </>
      )}
    </DialogFrame>
  );
}

export default definePluginApp((app) => {
  app.slots.settingsSection({
    id: "accounts",
    component: AccountPoolSettings,
  });
});
