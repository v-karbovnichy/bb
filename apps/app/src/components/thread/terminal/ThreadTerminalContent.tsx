import { Button } from "@bb/shared-ui/button";
import type { MarkdownPreviewLinkHandler } from "@/components/ui/markdown-link";
import {
  SHORT_LIVED_STATUS_DELAY_MS,
  useSustainedFlag,
} from "@/hooks/useSustainedFlag";
import { ThreadTerminalView } from "./ThreadTerminalView";
import type { ThreadTerminalController } from "./useThreadTerminalController";

interface ThreadTerminalContentProps {
  autoFocus?: boolean;
  controller: ThreadTerminalController;
  onAutoFocusHandled?: () => void;
  onCloseStart: () => void;
  onOpenLink?: MarkdownPreviewLinkHandler;
  onRetryStart: () => void;
  onSelectionAddToChat?: (text: string) => void;
}

export function ThreadTerminalContent({
  autoFocus = false,
  controller,
  onAutoFocusHandled,
  onCloseStart,
  onOpenLink,
  onRetryStart,
  onSelectionAddToChat,
}: ThreadTerminalContentProps) {
  if (!controller.shouldMountTerminalView) {
    return null;
  }

  if (!controller.activeSession && controller.start !== null) {
    if (controller.start.error === null) {
      return <TerminalStarting />;
    }
    return (
      <div
        role="alert"
        className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center text-sm"
      >
        <div className="space-y-1">
          <p className="font-medium text-foreground">Не удалось запустить терминал</p>
          <p className="text-muted-foreground">{controller.start.error}</p>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onRetryStart}
          >
            Повторить
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onCloseStart}
          >
            Закрыть
          </Button>
        </div>
      </div>
    );
  }

  if (controller.hasTerminalQueryError) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-sm text-destructive-text">
        Не удалось загрузить терминалы.
      </div>
    );
  }

  if (!controller.activeSession) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-sm text-muted-foreground">
        {controller.terminalBodyMessage}
      </div>
    );
  }

  const status = controller.activeSession.status;
  if (status === "starting") {
    return <TerminalStarting />;
  }
  if (status === "exited") {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-sm">
        <p className="font-medium text-foreground">Терминал завершил работу</p>
      </div>
    );
  }

  return (
    <ThreadTerminalView
      autoFocus={autoFocus}
      isPanelOpen={controller.isPanelOpen}
      onAutoFocusHandled={onAutoFocusHandled}
      onOpenLink={onOpenLink}
      onSelectionAddToChat={onSelectionAddToChat}
      onSessionChange={controller.handleActiveTerminalSessionChange}
      onTitleChange={controller.handleActiveTerminalTitleChange}
      session={controller.activeSession}
    />
  );
}

function TerminalStarting() {
  const isSlow = useSustainedFlag(true, SHORT_LIVED_STATUS_DELAY_MS);
  return (
    <div
      aria-busy="true"
      aria-label="Запуск терминала"
      className="flex h-full items-center justify-center px-4 text-center text-sm text-muted-foreground"
    >
      {isSlow ? "Запуск терминала…" : null}
    </div>
  );
}
