import { Component, type ErrorInfo, type ReactNode } from "react";

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  error: Error | null;
}

export class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  override state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): AppErrorBoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[bb] the app crashed", error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (error === null) {
      return this.props.children;
    }
    return (
      <div className="flex h-dvh w-full items-center justify-center bg-background p-6 text-foreground">
        <div className="w-full max-w-md rounded-lg border border-border bg-card p-6">
          <h1 className="text-base font-medium">
            В bb произошла ошибка, приложение остановлено
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Можно безопасно перезагрузить приложение. Чаты хранятся на сервере,
            а неотправленный черновик — на этом устройстве. Если ошибка
            повторится, откройте консоль браузера и отправьте нам сообщение ниже.
          </p>
          <details className="mt-4">
            <summary className="cursor-pointer text-sm text-muted-foreground">
              Подробности ошибки
            </summary>
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border p-3 text-xs">
              {error.stack ?? error.message}
            </pre>
          </details>
          <button
            type="button"
            className="mt-4 w-full cursor-pointer rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground"
            onClick={() => window.location.reload()}
          >
            Перезагрузить bb
          </button>
        </div>
      </div>
    );
  }
}
