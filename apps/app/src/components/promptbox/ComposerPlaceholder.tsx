import type { HTMLAttributes } from "react";
import { Button } from "@bb/shared-ui/button";
import { cn } from "@bb/shared-ui/lib/utils";
import { Skeleton } from "@bb/shared-ui/skeleton";

export type ComposerLoadingShape = "thread" | "thread-compact" | "new-thread";

const COMPOSER_LOADING_SHAPE_CLASS: Record<ComposerLoadingShape, string> = {
  thread: "h-[151px]",
  "thread-compact": "h-[50px]",
  "new-thread": "h-32 max-md:pointer-coarse:h-34",
};

export function ComposerLoadingSkeleton({
  shape,
  ...props
}: HTMLAttributes<HTMLDivElement> & { shape: ComposerLoadingShape }) {
  return (
    <Skeleton
      {...props}
      className={cn(
        "w-full shrink-0 rounded-xl",
        COMPOSER_LOADING_SHAPE_CLASS[shape],
      )}
    />
  );
}

export type ComposerPlaceholderState =
  | { kind: "loading"; shape: ComposerLoadingShape }
  | { kind: "missing" }
  | { kind: "failed"; onRetry: () => void }
  | { kind: "crashed"; pluginTitle: string; onReload: () => void };

export function ComposerPlaceholder({
  state,
}: {
  state: ComposerPlaceholderState;
}) {
  if (state.kind === "loading") {
    return (
      <ComposerLoadingSkeleton
        shape={state.shape}
        aria-label="Загрузка поля ввода"
        data-composer-placeholder="loading"
      />
    );
  }
  if (state.kind === "missing") {
    return (
      <div
        role="status"
        data-composer-placeholder="missing"
        className="px-1 py-2 text-sm text-muted-foreground"
      >
        Плагин поля ввода не включён.
      </div>
    );
  }
  const alert =
    state.kind === "failed"
      ? {
          message: "Не удалось загрузить поле ввода.",
          action: "Повторить",
          onClick: state.onRetry,
        }
      : {
          message: `${state.pluginTitle} stopped working.`,
          action: "Перезагрузить",
          onClick: state.onReload,
        };
  return (
    <div
      role="alert"
      data-composer-placeholder={state.kind}
      className="flex items-center justify-between gap-2 rounded-xl border border-border bg-background px-3 py-2 text-sm text-muted-foreground"
    >
      <span>{alert.message}</span>
      <Button type="button" variant="outline" size="sm" onClick={alert.onClick}>
        {alert.action}
      </Button>
    </div>
  );
}
