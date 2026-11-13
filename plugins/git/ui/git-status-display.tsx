import { useState } from "react";
import { Icon } from "@bb/shared-ui/icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@bb/shared-ui/tooltip";
import { experimental_PluginRpcCallError } from "@get-bb/plugin-sdk";

export interface GitStatusDisplayStatus {
  workingTree: {
    state:
      | "clean"
      | "untracked"
      | "dirty_uncommitted"
      | "committed_unmerged"
      | "dirty_and_committed_unmerged";
  };
  mergeBase: {
    mergeBaseBranch: string;
    aheadCount: number;
    behindCount: number;
    squashMergeCheckComplete: boolean;
  } | null;
}

export const INCOMPLETE_SQUASH_MERGE_MESSAGE =
  "Проверка объединения со сжатием не завершена; в количестве могут учитываться уже объединённые коммиты.";

export interface ThreadGitStatusDisplay {
  label:
    | "Неизвестно"
    | "Актуально"
    | "Чисто"
    | "Впереди"
    | "Позади"
    | "Разошлись"
    | "Есть изменения"
    | "Неотслеживаемые";
  summary: string;
  warning?: string;
}

const GIT_STATUS_REFUSAL_CODES: ReadonlySet<string> = new Set([
  "forbidden",
  "not_found",
  "conflict",
  "invalid",
]);

export function gitStatusErrorMessage(error: Error | null): string | null {
  if (error === null) return null;
  return error instanceof experimental_PluginRpcCallError &&
    GIT_STATUS_REFUSAL_CODES.has(error.code)
    ? error.message
    : "Статус рабочей копии недоступен.";
}

interface GetGitStatusDisplayOptions {
  errorMessage?: string | null;
  mergeBaseBranch?: string;
  showBranchComparison?: boolean;
  workspaceUnavailable?: { code: string; message: string };
  workspaceDeleted?: boolean;
}

function formatComparisonSummary(
  status: GitStatusDisplayStatus,
  mergeBaseBranch?: string,
): string | null {
  const aheadCount = status.mergeBase?.aheadCount ?? 0;
  const behindCount = status.mergeBase?.behindCount ?? 0;
  if (aheadCount === 0 && behindCount === 0) {
    return null;
  }

  if (aheadCount > 0 && behindCount > 0) {
    return mergeBaseBranch
      ? `Впереди на ${aheadCount}, позади на ${behindCount} относительно ${mergeBaseBranch}`
      : `Впереди на ${aheadCount}, позади на ${behindCount}`;
  }

  if (aheadCount > 0) {
    return mergeBaseBranch
      ? `Впереди ${mergeBaseBranch} на ${aheadCount}`
      : `Впереди на ${aheadCount}`;
  }

  return mergeBaseBranch
    ? `Позади ${mergeBaseBranch} на ${behindCount}`
    : `Позади на ${behindCount}`;
}

function plainDisplay(
  label: ThreadGitStatusDisplay["label"],
  summary: string,
): ThreadGitStatusDisplay {
  return { label, summary };
}

function divergenceDisplay(
  status: GitStatusDisplayStatus,
  comparisonSummary: string | null,
): ThreadGitStatusDisplay | null {
  const aheadCount = status.mergeBase?.aheadCount ?? 0;
  const behindCount = status.mergeBase?.behindCount ?? 0;
  if (aheadCount > 0 && behindCount > 0) {
    return plainDisplay(
      "Разошлись",
      comparisonSummary ?? "Ветки разошлись.",
    );
  }
  if (behindCount > 0) {
    return plainDisplay(
      "Позади",
      comparisonSummary ?? "Ветка отстаёт от базы слияния.",
    );
  }
  return null;
}

function getGitStatusDisplayWithoutWarning(
  status: GitStatusDisplayStatus | undefined,
  options?: GetGitStatusDisplayOptions,
): ThreadGitStatusDisplay {
  if (!status) {
    if (options?.workspaceUnavailable) {
      if (options.workspaceUnavailable.code === "path_not_found") {
        return plainDisplay("Неизвестно", "Рабочая копия не найдена.");
      }
      return plainDisplay("Неизвестно", options.workspaceUnavailable.message);
    }

    if (options?.workspaceDeleted) {
      return plainDisplay("Неизвестно", "Рабочая копия не найдена.");
    }
    return plainDisplay(
      "Неизвестно",
      options?.errorMessage ?? "Статус рабочей копии недоступен.",
    );
  }

  const resolvedMergeBaseBranch =
    options?.mergeBaseBranch ?? status.mergeBase?.mergeBaseBranch;
  const comparisonSummary = options?.showBranchComparison
    ? formatComparisonSummary(status, resolvedMergeBaseBranch)
    : null;

  switch (status.workingTree.state) {
    case "clean":
      return (
        divergenceDisplay(status, comparisonSummary) ??
        ((status.mergeBase?.aheadCount ?? 0) > 0
          ? plainDisplay(
              "Впереди",
              comparisonSummary ?? "Локальные коммиты ожидают объединения.",
            )
          : plainDisplay(
              options?.showBranchComparison ? "Актуально" : "Чисто",
              resolvedMergeBaseBranch
                ? `Нет локальных изменений относительно ${resolvedMergeBaseBranch}.`
                : "Нет локальных изменений.",
            ))
      );
    case "untracked":
      return plainDisplay("Неотслеживаемые", comparisonSummary ?? "");
    case "dirty_uncommitted":
    case "dirty_and_committed_unmerged":
      return plainDisplay("Есть изменения", comparisonSummary ?? "");
    case "committed_unmerged":
      return (
        divergenceDisplay(status, comparisonSummary) ??
        plainDisplay(
          "Впереди",
          comparisonSummary ?? "Локальные коммиты ожидают объединения.",
        )
      );
  }
}

export function getGitStatusDisplay(
  status: GitStatusDisplayStatus | undefined,
  options?: GetGitStatusDisplayOptions,
): ThreadGitStatusDisplay {
  const display = getGitStatusDisplayWithoutWarning(status, options);
  return status?.mergeBase?.squashMergeCheckComplete === false
    ? { ...display, warning: INCOMPLETE_SQUASH_MERGE_MESSAGE }
    : display;
}

export function SquashMergeInfo() {
  const [open, setOpen] = useState(false);
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={INCOMPLETE_SQUASH_MERGE_MESSAGE}
          onPointerDown={(event) => {
            event.preventDefault();
            setOpen((value) => !value);
          }}
          onClick={(event) => {
            event.preventDefault();
            if (event.detail === 0) setOpen((value) => !value);
          }}
          className="inline-flex shrink-0 items-center text-muted-foreground"
        >
          <Icon name="Info" className="size-3" aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent>{INCOMPLETE_SQUASH_MERGE_MESSAGE}</TooltipContent>
    </Tooltip>
  );
}
