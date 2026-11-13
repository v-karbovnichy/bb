import { useState, type ReactNode } from "react";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { getNativeShell } from "@/lib/native-shell/native-shell";
import type { TerminalNavigationKey } from "./terminal-mobile-input";

interface TerminalMobileControlsProps {
  controlActive: boolean;
  disabled: boolean;
  onArrow: (key: TerminalNavigationKey) => void;
  onControlChange: (active: boolean) => void;
  onInput: (data: string) => void;
  onKeyboardToggle: () => void;
  onPaste: () => void;
}

function Key({
  label,
  children,
  onPress,
  active = false,
  toggle = false,
  disabled,
  className,
}: {
  label: string;
  children: ReactNode;
  onPress: () => void;
  active?: boolean;
  toggle?: boolean;
  disabled: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={toggle ? active : undefined}
      disabled={disabled}
      onPointerDown={(event) => event.preventDefault()}
      onClick={() => {
        const shell = getNativeShell();
        if (shell?.has("haptic"))
          shell.post({ type: "haptic", kind: "selection" });
        onPress();
      }}
      className={cn(
        "flex h-11 min-w-0 flex-1 touch-manipulation items-center justify-center rounded-md font-mono text-xs font-medium text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground active:bg-state-active active:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40",
        active && "bg-state-active text-foreground",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function TerminalMobileControls({
  controlActive,
  disabled,
  onArrow,
  onControlChange,
  onInput,
  onKeyboardToggle,
  onPaste,
}: TerminalMobileControlsProps) {
  const [expanded, setExpanded] = useState(false);
  const keyProps = { disabled };
  return (
    <div
      role="group"
      aria-label="Клавиши терминала"
      data-terminal-mobile-controls=""
      className="shrink-0 border-t border-border/50 bg-sidebar px-2 py-1"
    >
      {expanded ? (
        <div className="mb-1 flex gap-1">
          <Key
            {...keyProps}
            label="Прервать (Control C)"
            onPress={() => onInput("\x03")}
          >
            ^C
          </Key>
          <Key
            {...keyProps}
            label="Конец ввода (Control D)"
            onPress={() => onInput("\x04")}
          >
            ^D
          </Key>
          <Key {...keyProps} label="В начало" onPress={() => onInput("\x1b[H")}>
            Home
          </Key>
          <Key {...keyProps} label="В конец" onPress={() => onInput("\x1b[F")}>
            End
          </Key>
          <Key {...keyProps} label="Вставить" onPress={onPaste}>
            Paste
          </Key>
          <Key
            {...keyProps}
            label="Показать или скрыть клавиатуру"
            onPress={onKeyboardToggle}
          >
            <Icon name="Keyboard" className="size-4" />
          </Key>
        </div>
      ) : null}
      <div className="flex gap-1">
        <Key {...keyProps} label="Escape" onPress={() => onInput("\x1b")}>
          Esc
        </Key>
        <Key {...keyProps} label="Tab" onPress={() => onInput("\t")}>
          Tab
        </Key>
        <Key
          {...keyProps}
          label="Control для следующей клавиши"
          toggle
          active={controlActive}
          onPress={() => onControlChange(!controlActive)}
        >
          Ctrl
        </Key>
        <div className="flex min-w-0 flex-[4] gap-1">
          <Key {...keyProps} label="Стрелка влево" onPress={() => onArrow("left")}>
            <Icon name="ArrowLeft" className="size-4" />
          </Key>
          <Key {...keyProps} label="Стрелка вниз" onPress={() => onArrow("down")}>
            <Icon name="ArrowDown" className="size-4" />
          </Key>
          <Key {...keyProps} label="Стрелка вверх" onPress={() => onArrow("up")}>
            <Icon name="ArrowUp" className="size-4" />
          </Key>
          <Key
            {...keyProps}
            label="Стрелка вправо"
            onPress={() => onArrow("right")}
          >
            <Icon name="ArrowRight" className="size-4" />
          </Key>
        </div>
        <Key {...keyProps} label="Enter" onPress={() => onInput("\r")}>
          <Icon name="CornerDownLeft" className="size-4" />
        </Key>
        <Key
          {...keyProps}
          label="Больше клавиш терминала"
          toggle
          active={expanded}
          onPress={() => setExpanded(!expanded)}
        >
          <Icon name="MoreHorizontal" className="size-4" />
        </Key>
      </div>
    </div>
  );
}
