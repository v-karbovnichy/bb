import type {
  DesktopBrowserImportFailureReason,
  DesktopBrowserImportOutcome,
  DesktopBrowserImportSource,
} from "@bb/host-daemon-contract";

export interface BrowserImportRecord {
  at: number;
  profileName: string;
  imported: number;
  skipped: number;
  skippedDomains: readonly string[];
}

export type BrowserImportRecords = Readonly<
  Partial<Record<DesktopBrowserImportSource["id"], BrowserImportRecord>>
>;

export const BROWSER_IMPORT_RECORDS_STORAGE_KEY = "bb:browser-import:records";

export function readBrowserImportRecords(
  storage: Pick<Storage, "getItem"> | null,
): BrowserImportRecords {
  try {
    const raw = storage?.getItem(BROWSER_IMPORT_RECORDS_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const records: Partial<Record<string, BrowserImportRecord>> = {};
    for (const [id, value] of Object.entries(parsed)) {
      if (typeof value !== "object" || value === null) continue;
      const record = value as Partial<BrowserImportRecord>;
      if (
        typeof record.at !== "number" ||
        typeof record.profileName !== "string" ||
        typeof record.imported !== "number" ||
        typeof record.skipped !== "number" ||
        !Array.isArray(record.skippedDomains)
      )
        continue;
      records[id] = {
        at: record.at,
        profileName: record.profileName,
        imported: record.imported,
        skipped: record.skipped,
        skippedDomains: record.skippedDomains.filter(
          (domain): domain is string => typeof domain === "string",
        ),
      };
    }
    return records as BrowserImportRecords;
  } catch {
    return {};
  }
}

export type BrowserImportDialogStep =
  | { step: "configure" }
  | { step: "fullDiskAccess"; checked: boolean }
  | { step: "checking" }
  | { step: "importing" }
  | { step: "blocked"; reason: DesktopBrowserImportFailureReason };

export function initialDialogStep(
  source: DesktopBrowserImportSource,
): BrowserImportDialogStep {
  if (source.unavailable === "browserRunning")
    return { step: "blocked", reason: "browserRunning" };
  if (source.unavailable === "needsFullDiskAccess")
    return { step: "fullDiskAccess", checked: false };
  if (source.unavailable !== undefined)
    return { step: "blocked", reason: source.unavailable };
  if (source.profiles.length === 0)
    return { step: "blocked", reason: "unknownSourceProfile" };
  return { step: "configure" };
}

export function failedDialogStep(
  reason: DesktopBrowserImportFailureReason,
): BrowserImportDialogStep {
  if (reason === "needsFullDiskAccess")
    return { step: "fullDiskAccess", checked: true };
  return { step: "blocked", reason };
}

export function sourceAfterFailure(
  source: DesktopBrowserImportSource,
  reason: DesktopBrowserImportFailureReason,
): DesktopBrowserImportSource | null {
  switch (reason) {
    case "browserRunning":
    case "needsFullDiskAccess":
    case "needsKeychainApproval":
    case "keychainItemMissing":
      return { ...source, unavailable: reason };
    default:
      return null;
  }
}

export function refreshedDialogStep(
  source: DesktopBrowserImportSource | undefined,
  previous: BrowserImportDialogStep,
): BrowserImportDialogStep {
  if (source === undefined) return { step: "blocked", reason: "unknownSource" };
  const next = initialDialogStep(source);
  if (next.step === "fullDiskAccess" && previous.step === "fullDiskAccess")
    return { step: "fullDiskAccess", checked: true };
  return next;
}

export function canCloseDialog(step: BrowserImportDialogStep): boolean {
  return step.step !== "importing";
}

export function needsProfileChoice(
  source: DesktopBrowserImportSource,
): boolean {
  return source.unavailable === undefined && source.profiles.length > 1;
}

export function preferredSourceProfileDirectory(
  current: string | null,
  source: DesktopBrowserImportSource,
): string | null {
  if (
    current !== null &&
    source.profiles.some((profile) => profile.directory === current)
  )
    return current;
  return source.profiles[0]?.directory ?? null;
}

export function recordFromOutcome(
  outcome: DesktopBrowserImportOutcome & { ok: true },
  profileName: string,
  at: number,
): BrowserImportRecord {
  return {
    at,
    profileName,
    imported: outcome.imported,
    skipped: outcome.skipped,
    skippedDomains: outcome.skippedDomains,
  };
}

export function formatCookieCount(count: number): string {
  return `Файлов cookie: ${count.toLocaleString()}`;
}

export function formatSkippedDomains(domains: readonly string[]): string {
  if (domains.length === 0) return "";
  if (domains.length === 1) return domains[0];
  if (domains.length <= 3)
    return `${domains.slice(0, -1).join(", ")} и ${domains[domains.length - 1]}`;
  return `${domains.slice(0, 3).join(", ")} и ещё ${domains.length - 3}`;
}

export function listedSources(
  sources: readonly DesktopBrowserImportSource[],
): DesktopBrowserImportSource[] {
  return sources.filter(
    (source) =>
      source.unavailable !== "unsupportedPlatform" &&
      source.unavailable !== "notInstalled",
  );
}

export type SourceRowTone = "ready" | "attention" | "idle";

export interface SourceRowPresentation {
  status: string;
  tone: SourceRowTone;
  details: string[];
  action: "import" | "recheck" | "grant" | "none";
  actionLabel: string;
}

export function totalCookies(
  source: DesktopBrowserImportSource,
): number | undefined {
  let total = 0;
  let known = false;
  for (const profile of source.profiles) {
    if (profile.cookieCount === undefined) return undefined;
    total += profile.cookieCount;
    known = true;
  }
  return known ? total : undefined;
}

export function presentSourceRow(
  source: DesktopBrowserImportSource,
  record: BrowserImportRecord | undefined,
): SourceRowPresentation {
  const profileCount = source.profiles.length;
  const profileLabel = `Профилей: ${profileCount}`;
  const cookies = totalCookies(source);
  switch (source.unavailable) {
    case "browserRunning":
      return {
        status: `Запущен · закройте ${source.name} для импорта`,
        tone: "attention",
        details: [],
        action: "recheck",
        actionLabel: "Проверить снова",
      };
    case "needsFullDiskAccess":
      return {
        status: "Нужен полный доступ к диску",
        tone: "attention",
        details: [],
        action: "grant",
        actionLabel: "Предоставить доступ…",
      };
    case "needsKeychainApproval":
      return {
        status: "Нужен доступ к связке ключей",
        tone: "attention",
        details: [],
        action: "import",
        actionLabel: "Импортировать…",
      };
    case "keychainItemMissing":
      return {
        status: "Нет ключа шифрования в связке ключей",
        tone: "idle",
        details: [],
        action: "recheck",
        actionLabel: "Проверить снова",
      };
    case undefined:
      break;
    default:
      return {
        status: "Недоступно",
        tone: "idle",
        details: [],
        action: "none",
        actionLabel: "Импортировать…",
      };
  }
  if (profileCount === 0 || cookies === 0) {
    return {
      status: "Пока нет файлов cookie",
      tone: "idle",
      details: profileCount === 0 ? [] : [profileLabel],
      action: "none",
      actionLabel: "Импортировать…",
    };
  }
  const details = record
    ? [
        `${record.profileName} · импортировано: ${formatCookieCount(record.imported)}`,
        ...(record.skipped > 0
          ? [
              `Пропущено: ${record.skipped.toLocaleString()}${
                record.skippedDomains.length > 0
                  ? ` (${formatSkippedDomains(record.skippedDomains)})`
                  : ""
              }`,
            ]
          : []),
      ]
    : cookies === undefined
      ? [profileLabel]
      : [profileLabel, formatCookieCount(cookies)];
  return {
    status: "Готово",
    tone: "ready",
    details,
    action: "import",
    actionLabel: "Импортировать…",
  };
}
