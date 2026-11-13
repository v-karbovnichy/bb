import type { PullRequest, PullRequestState } from "../contract";
import type { IconName } from "@bb/shared-ui/icon";

interface PullRequestDisplay {
  label: string;
  icon: IconName;
  className: string;
}

export type GithubCheckStatus = "success" | "failure" | "pending";

interface PullRequestStateDisplay extends PullRequestDisplay {
  dotClass: string;
}

export const PULL_REQUEST_STATE_DISPLAY: Record<
  PullRequestState,
  PullRequestStateDisplay
> = {
  open: {
    label: "Открыт",
    icon: "GitPullRequestArrow",
    className: "text-success-foreground",
    dotClass: "bg-success",
  },
  draft: {
    label: "Черновик",
    icon: "GitPullRequestDraft",
    className: "text-muted-foreground",
    dotClass: "bg-muted-foreground",
  },
  merged: {
    label: "Объединён",
    icon: "GitMerge",
    className: "text-pr-merged",
    dotClass: "bg-pr-merged",
  },
  closed: {
    label: "Закрыт",
    icon: "GitPullRequestClosed",
    className: "text-destructive-text",
    dotClass: "bg-destructive",
  },
};

export type PullRequestNextStepTone = "action" | "ready" | "waiting";

export interface PullRequestNextStep {
  label: string;
  tone: PullRequestNextStepTone;
  icon: IconName | null;
  running: boolean;
}

export const PULL_REQUEST_NEXT_STEP_TONE_CLASS: Record<
  PullRequestNextStepTone,
  string
> = {
  action: "text-destructive-text",
  ready: "text-success-foreground",
  waiting: "text-muted-foreground",
};

function action(label: string): PullRequestNextStep {
  return { label, tone: "action", icon: null, running: false };
}

function waiting(label: string): PullRequestNextStep {
  return { label, tone: "waiting", icon: null, running: false };
}

const CHECKS_FAILING_STEP: PullRequestNextStep = {
  label: "Проверки не пройдены",
  tone: "action",
  icon: "CircleX",
  running: false,
};

const CHECKS_RUNNING_STEP: PullRequestNextStep = {
  label: "Проверки выполняются",
  tone: "waiting",
  icon: "Clock",
  running: true,
};

function checksResult(label: string, icon: IconName): PullRequestNextStep {
  return { label, tone: "waiting", icon, running: false };
}

function blockedStep(pullRequest: PullRequest): PullRequestNextStep {
  switch (pullRequest.mergeability.mergeStateStatus) {
    case "BEHIND":
      return action(`Позади ${pullRequest.baseRefName}`);
    default:
      return action("Заблокирован правилами");
  }
}

function checksStep(pullRequest: PullRequest): PullRequestNextStep {
  switch (pullRequest.checks.state) {
    case "passing":
      return checksResult("Проверки пройдены", "CircleCheck");
    case "failing":
      return CHECKS_FAILING_STEP;
    case "pending":
      return CHECKS_RUNNING_STEP;
    case "no_checks":
      return checksResult("Нет проверок", "Circle");
    case "unknown":
      return checksResult("Статус проверок неизвестен", "CircleQuestion");
  }
}

export function getPullRequestNextStep(
  pullRequest: PullRequest,
): PullRequestNextStep | null {
  switch (pullRequest.attention) {
    case "merged":
    case "closed":
      return null;
    case "checks_failed":
      return CHECKS_FAILING_STEP;
    case "changes_requested":
      return action("Запрошены изменения");
    case "conflicts":
      return action(`Конфликт с ${pullRequest.baseRefName}`);
    case "blocked":
      return blockedStep(pullRequest);
    case "checks_pending":
      return CHECKS_RUNNING_STEP;
    case "review_requested":
      return waiting(
        pullRequest.review.state === "review_required"
          ? "Требуется ревью"
          : "Ревью запрошено",
      );
    case "queued":
      return waiting("В очереди на объединение");
    case "ready_to_merge":
      return {
        label: "Готов к объединению",
        tone: "ready",
        icon: null,
        running: false,
      };
    case "draft":
    case "none":
      return checksStep(pullRequest);
  }
}

export function describePullRequestStatus(pullRequest: PullRequest): string {
  const nextStep = getPullRequestNextStep(pullRequest);
  return [
    PULL_REQUEST_STATE_DISPLAY[pullRequest.state].label,
    nextStep?.label,
    isPullRequestAutoMergeOn(pullRequest) ? "автообъединение включено" : null,
  ]
    .filter((part) => part)
    .join(", ");
}

export function isPullRequestAutoMergeOn(pullRequest: PullRequest): boolean {
  return pullRequest.state === "open" && pullRequest.autoMerge;
}

export function getPullRequestGithubCheckStatus(
  pullRequest: PullRequest,
): GithubCheckStatus | null {
  if (pullRequest.state !== "open" && pullRequest.state !== "draft") {
    return null;
  }
  switch (pullRequest.checks.state) {
    case "passing":
      return "success";
    case "failing":
      return "failure";
    case "pending":
      return "pending";
    case "no_checks":
    case "unknown":
      return null;
  }
}

export function getPullRequestStateDisplay(
  pullRequest: PullRequest,
): PullRequestStateDisplay {
  return PULL_REQUEST_STATE_DISPLAY[pullRequest.state];
}
