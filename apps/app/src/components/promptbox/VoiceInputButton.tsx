import { useCallback, useRef, useState, type ComponentProps } from "react";
import { cn } from "@bb/shared-ui/lib/utils";
import { Button } from "@bb/shared-ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@bb/shared-ui/tooltip";
import { Icon } from "@bb/shared-ui/icon";
import { Popover, PopoverAnchor } from "@bb/shared-ui/popover";
import { MicrophonePreferencesSplit } from "./MicrophonePreferencesSplit";
import { MicrophonePreferencesPopoverContent } from "./MicrophonePreferencesPopoverContent";

export function VoiceInputButton({
  warning,
  ...props
}: ComponentProps<typeof Button> & {
  warning: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [recoveredWarning, setRecoveredWarning] = useState<string | null>(null);
  const visibleWarning = recoveredWarning === warning ? null : warning;
  const handleCaptureReady = useCallback(
    () => setRecoveredWarning(warning),
    [warning],
  );
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <span
          className="relative inline-flex shrink-0"
          {...MicrophonePreferencesSplit.intentProps}
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                {...props}
                ref={triggerRef}
                className={cn("relative", props.className)}
                aria-label={
                  visibleWarning
                    ? "Предупреждение микрофона: откройте настройки голосового ввода"
                    : props["aria-label"]
                }
                onClick={(event) => {
                  if (visibleWarning) {
                    setOpen(true);
                  } else {
                    setRecoveredWarning(null);
                    props.onClick?.(event);
                  }
                }}
                aria-description="Нажмите правой кнопкой мыши или Shift+F10 для настроек голосового ввода"
                onContextMenu={(event) => {
                  event.preventDefault();
                  setOpen(true);
                }}
                onKeyDown={(event) => {
                  props.onKeyDown?.(event);
                  if (
                    event.key === "ContextMenu" ||
                    (event.shiftKey && event.key === "F10")
                  ) {
                    event.preventDefault();
                    setOpen(true);
                  }
                }}
              >
                {props.children}
                {visibleWarning ? (
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute bottom-0 right-0 flex size-4 items-center justify-center rounded-full bg-background text-destructive"
                  >
                    <Icon name="AlertTriangle" className="size-3" />
                  </span>
                ) : null}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {visibleWarning ? (
                <>
                  <span className="block">{visibleWarning}</span>
                  <span className="block">
                    Нажмите, чтобы открыть настройки голосового ввода.
                  </span>
                </>
              ) : (
                "Начать голосовой ввод · Правая кнопка мыши — настройки"
              )}
            </TooltipContent>
          </Tooltip>
        </span>
      </PopoverAnchor>
      <MicrophonePreferencesPopoverContent
        open={open}
        onClose={() => setOpen(false)}
        warning={visibleWarning}
        onCaptureReady={handleCaptureReady}
        align="end"
        side="top"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          triggerRef.current?.focus();
        }}
      />
    </Popover>
  );
}
