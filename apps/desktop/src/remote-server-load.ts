import type { StartupAction } from "./local-view.js";

const ELECTRON_LOAD_ERROR_CODE = /\bERR_[A-Z_]+ \(-?\d+\)/u;

interface RemoteServerStartupError {
  actions: StartupAction[];
  details: string;
  logs: string;
  title: string;
}

export interface LoadRemoteServerPageArgs {
  isCurrent(): boolean;
  loadStartupError(args: RemoteServerStartupError): Promise<void>;
  loadUrl(args: { url: string }): Promise<void>;
  logWarning(message: string): void;
  serverUrl: string;
}

function describeServerUrl(serverUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(serverUrl);
  } catch {
    return "сохранённый сервер bb";
  }
  return `сервер bb по адресу ${parsed.origin}`;
}

function formatLoadFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return ELECTRON_LOAD_ERROR_CODE.exec(message)?.[0] ?? "не удалось загрузить страницу";
}

export async function loadRemoteServerPage(
  args: LoadRemoteServerPageArgs,
): Promise<boolean> {
  try {
    await args.loadUrl({ url: args.serverUrl });
    return true;
  } catch (error) {
    if (!args.isCurrent()) {
      return false;
    }
    const label = describeServerUrl(args.serverUrl);
    args.logWarning(
      `[desktop] could not load ${label}: ${formatLoadFailure(error)}`,
    );
    await args.loadStartupError({
      actions: [
        { id: "retry", label: "Повторить" },
        { id: "choose-server", label: "Выбрать сервер…" },
      ],
      details:
        `${label.charAt(0).toUpperCase()}${label.slice(1)} не ответил. ` +
        "Убедитесь, что машина включена и доступна.",
      logs: "",
      title: "Не удалось связаться с сервером bb",
    });
    return false;
  }
}
