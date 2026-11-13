import {
  getWorkspaceGitOperation,
  hasUncommittedChanges,
  pathExists,
  readCheckoutRef,
  readGitRepo,
  readRefs,
  runGit,
  WorkspaceError,
  type GitRepo,
} from "bb-environment-provider-host/git";
import { tryWithCheckoutMutationLock } from "bb-environment-provider-host/locks";
import {
  emitStep,
  throwIfProvisionAborted,
  type ProgressCallback,
} from "bb-environment-provider-host/transcript";
import type { CheckoutBranch, CheckoutInspection } from "../contract.js";

interface AttachCheckoutArgs {
  path: string;
  branch: CheckoutBranch | null;
  onProgress?: ProgressCallback | undefined;
  signal?: AbortSignal | undefined;
}

export interface AttachedCheckout {
  path: string;
  branchName: string | null;
  mergeBaseBranch: string | null;
}

function checkoutLabel(
  branch: CheckoutBranch,
  phase: "waiting" | "ready" | "doing" | "done" | "failed",
): string {
  const verb =
    branch.kind === "new"
      ? {
          waiting: "Ожидание создания ветки",
          ready: "Готово к созданию ветки",
          doing: "Создание ветки",
          done: "Ветка создана:",
          failed: "Не удалось создать ветку",
        }[phase]
      : {
          waiting: "Ожидание переключения на ветку",
          ready: "Готово к переключению на ветку",
          doing: "Переключение на ветку",
          done: "Переключились на ветку",
          failed: "Не удалось переключиться на ветку",
        }[phase];
  return `${verb} ${branch.name}`;
}

type BranchLocation = "local" | "origin" | "missing";

interface SwitchPlan {
  switchArgs: string[];
  startPoint: string | null;
  location: BranchLocation;
}

async function locateBranch(
  repo: GitRepo,
  name: string,
): Promise<BranchLocation> {
  const localRef = `refs/heads/${name}`;
  const originRef = `refs/remotes/origin/${name}`;
  const refs = await readRefs(repo.path, [localRef, originRef]);
  if (refs.has(localRef)) {
    return "local";
  }
  if (refs.has(originRef)) {
    return "origin";
  }
  return "missing";
}

async function assertSwitchable(
  repo: GitRepo,
  branch: CheckoutBranch,
  plan: SwitchPlan,
): Promise<"already-current" | "ready"> {
  const ref = await readCheckoutRef(repo);
  if (
    (ref.kind === "branch" || ref.kind === "unborn") &&
    ref.branchName === branch.name
  ) {
    return "already-current";
  }
  switch (ref.kind) {
    case "branch":
      break;
    case "detached":
      throw new WorkspaceError(
        "checkout_detached",
        "Нельзя переключить ветку, пока HEAD рабочей копии отсоединён",
      );
    case "unborn":
      throw new WorkspaceError(
        "checkout_unborn",
        "Нельзя переключить ветку до первого коммита в текущей ветке",
      );
    case "unknown":
      throw new WorkspaceError(
        "checkout_unknown",
        `Не удалось проверить текущую рабочую копию: ${ref.reason}`,
      );
  }
  if (branch.kind === "existing" && plan.location === "missing") {
    throw new WorkspaceError(
      "checkout_missing_branch",
      `Нельзя переключиться на несуществующую ветку ${branch.name}`,
    );
  }
  const operation = await getWorkspaceGitOperation(repo);
  if (operation.kind !== "none" && operation.hasConflicts) {
    throw new WorkspaceError(
      "checkout_conflicts",
      `Нельзя переключить ветку: в операции ${operation.kind} есть неразрешённые конфликты`,
    );
  }
  if (operation.kind !== "none") {
    throw new WorkspaceError(
      "checkout_in_progress_operation",
      `Нельзя переключить ветку, пока выполняется ${operation.kind}`,
    );
  }
  if (await hasUncommittedChanges(repo.path)) {
    throw new WorkspaceError(
      "checkout_dirty",
      "Нельзя переключить ветку: в рабочей копии есть несохранённые изменения",
    );
  }
  return "ready";
}

async function planSwitch(
  repo: GitRepo,
  branch: CheckoutBranch,
): Promise<SwitchPlan> {
  if (branch.kind === "existing") {
    const location = await locateBranch(repo, branch.name);
    return {
      switchArgs:
        location === "origin"
          ? ["switch", "--track", `origin/${branch.name}`]
          : ["switch", branch.name],
      startPoint: null,
      location,
    };
  }
  const location = await locateBranch(repo, branch.baseBranch);
  const startPoint =
    location === "origin" ? `origin/${branch.baseBranch}` : branch.baseBranch;
  return {
    switchArgs: ["switch", "--no-track", "-C", branch.name, startPoint],
    startPoint,
    location,
  };
}

async function switchBranch(
  args: AttachCheckoutArgs & { branch: CheckoutBranch; repo: GitRepo },
): Promise<string | null> {
  const { path: cwd, branch, repo, onProgress, signal } = args;
  const waitingStartedAt = Date.now();
  emitStep({
    onProgress,
    key: "git-checkout-waiting",
    text: checkoutLabel(branch, "waiting"),
    status: "started",
    startedAt: waitingStartedAt,
  });
  let startedAt = waitingStartedAt;
  let waitingCompleted = false;
  let alreadyOnTarget = false;
  let startPoint: string | null = null;
  try {
    const locked = await tryWithCheckoutMutationLock(
      cwd,
      async () => {
        throwIfProvisionAborted(signal);
        const lockAcquiredAt = Date.now();
        emitStep({
          onProgress,
          key: "git-checkout-waiting",
          text: checkoutLabel(branch, "ready"),
          status: "completed",
          startedAt: waitingStartedAt,
          metadata: { durationMs: lockAcquiredAt - waitingStartedAt },
        });
        waitingCompleted = true;
        startedAt = lockAcquiredAt;
        const plan = await planSwitch(repo, branch);
        startPoint = plan.startPoint;
        if (
          (await assertSwitchable(repo, branch, plan)) === "already-current"
        ) {
          alreadyOnTarget = true;
          return;
        }
        emitStep({
          onProgress,
          key: "git-checkout-started",
          text: checkoutLabel(branch, "doing"),
          status: "started",
          startedAt,
        });
        await runGit(plan.switchArgs, {
          cwd,
          ...(signal !== undefined ? { signal } : {}),
        });
      },
      signal,
    );
    if (locked === null) {
      throw new WorkspaceError(
        "not_git_repo",
        `Cannot checkout branch on non-git workspace: ${cwd}`,
      );
    }
    waitingCompleted = true;
    emitStep({
      onProgress,
      key: "git-checkout-completed",
      text: alreadyOnTarget
        ? `Already on branch ${branch.name}`
        : checkoutLabel(branch, "done"),
      status: "completed",
      startedAt,
      metadata: { durationMs: Date.now() - startedAt },
    });
  } catch (error) {
    const failedAt = Date.now();
    if (!waitingCompleted) {
      emitStep({
        onProgress,
        key: "git-checkout-waiting",
        text: `Failed ${checkoutLabel(branch, "waiting").toLowerCase()}`,
        status: "failed",
        startedAt: waitingStartedAt,
        metadata: { durationMs: failedAt - waitingStartedAt },
      });
    }
    emitStep({
      onProgress,
      key: "git-checkout-failed",
      text: checkoutLabel(branch, "failed"),
      status: "failed",
      startedAt,
      metadata: { durationMs: failedAt - startedAt },
    });
    throw error;
  }
  return startPoint;
}

async function readWorkTree(cwd: string): Promise<GitRepo | null> {
  const repo = await readGitRepo(cwd);
  return repo?.kind === "work-tree" ? repo : null;
}

export async function inspectCheckout(args: {
  path: string;
}): Promise<CheckoutInspection> {
  if (!(await pathExists(args.path))) {
    return { isGitRepo: false };
  }
  const repo = await readWorkTree(args.path);
  if (repo === null) {
    return { isGitRepo: false };
  }
  const [checkout, dirty, operation] = await Promise.all([
    readCheckoutRef(repo),
    hasUncommittedChanges(repo.path),
    getWorkspaceGitOperation(repo),
  ]);
  return {
    isGitRepo: true,
    checkout,
    hasUncommittedChanges: dirty,
    operation,
  };
}

export async function attachCheckout(
  args: AttachCheckoutArgs,
): Promise<AttachedCheckout> {
  throwIfProvisionAborted(args.signal);
  if (!(await pathExists(args.path))) {
    throw new WorkspaceError(
      "path_not_found",
      `Workspace path does not exist: ${args.path}`,
    );
  }
  const repo = await readWorkTree(args.path);
  let mergeBaseBranch: string | null = null;
  if (args.branch !== null) {
    if (repo === null) {
      throw new WorkspaceError(
        "not_git_repo",
        `Cannot checkout branch on non-git workspace: ${args.path}`,
      );
    }
    mergeBaseBranch = await switchBranch({
      ...args,
      branch: args.branch,
      repo,
    });
  }
  if (repo === null) {
    return { path: args.path, branchName: null, mergeBaseBranch: null };
  }
  const ref = await readCheckoutRef(repo);
  return {
    path: args.path,
    branchName:
      ref.kind === "branch" || ref.kind === "unborn" ? ref.branchName : null,
    mergeBaseBranch,
  };
}
