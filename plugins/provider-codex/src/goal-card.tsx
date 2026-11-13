import {
  experimental_CollapsibleStackCard as CollapsibleStackCard,
  experimental_useThreadExtensionState,
  useComposer,
  useSdk,
} from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import {
  codexGoalStateSchema,
  type CodexGoal,
  type CodexGoalStatus,
} from "./extension-kinds.js";

const GOAL_STATUS_TITLES: Partial<Record<CodexGoalStatus, string>> = {
  active: "Цель",
  paused: "Цель приостановлена",
  blocked: "Цель заблокирована",
  usageLimited: "Лимит использования для цели исчерпан",
};

function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${Math.round(seconds)} с`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    const rest = Math.round(seconds % 60);
    return rest > 0 ? `${minutes} мин ${rest} с` : `${minutes} мин`;
  }
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes > 0 ? `${hours} ч ${restMinutes} мин` : `${hours} ч`;
}

function formatTokenUsage(goal: CodexGoal): string {
  const used = goal.tokensUsed.toLocaleString();
  if (goal.tokenBudget === null) {
    return `${used} токенов`;
  }
  return `${used} / ${goal.tokenBudget.toLocaleString()} токенов`;
}

function GoalCard({ threadId }: { threadId: string }) {
  const sdk = useSdk();
  const state = codexGoalStateSchema.safeParse(
    experimental_useThreadExtensionState(threadId, "goal"),
  );
  const goal = state.success ? state.data : null;
  const title = goal === null ? undefined : GOAL_STATUS_TITLES[goal.status];
  if (goal === null || title === undefined) return null;
  const isActive = goal.status === "active";
  const objective = goal.objective.trim();
  return (
    <CollapsibleStackCard
      label="Цель"
      title={title}
      icon="Target"
      isActive={isActive}
      dismiss={{
        label: isActive ? "Удалить активную цель" : "Удалить цель",
        failureMessage: "Не удалось удалить цель.",
        onDismiss: async () => {
          await sdk.threads.clearGoal({ threadId });
        },
      }}
    >
      <div className="space-y-2 px-3 pb-2.5 pt-2">
        <p className="whitespace-pre-wrap text-xs leading-relaxed text-foreground/90">
          {objective.length > 0 ? objective : "Описание цели отсутствует."}
        </p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Icon name="Zap" className="size-3.5 shrink-0" aria-hidden="true" />
            {formatTokenUsage(goal)}
          </span>
          <span className="inline-flex items-center gap-1.5 tabular-nums">
            <Icon
              name="Clock"
              className="size-3.5 shrink-0"
              aria-hidden="true"
            />
            {formatDuration(goal.timeUsedSeconds)}
          </span>
        </div>
      </div>
    </CollapsibleStackCard>
  );
}

export function CodexGoalBanner() {
  const { scope } = useComposer();
  return scope.kind === "thread" ? (
    <GoalCard threadId={scope.threadId} />
  ) : null;
}
