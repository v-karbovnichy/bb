import { ipcMain, type BrowserWindow } from "electron";
import { escapeHtmlText } from "@bb/text-utils";
import {
  createDesktopDialogWindow,
  DESKTOP_DIALOG_BASE_CSS,
  showDesktopDialogHtml,
} from "./desktop-dialog-window.js";
import {
  BB_DESKTOP_SERVER_URL_DIALOG_CANCEL_CHANNEL,
  BB_DESKTOP_SERVER_URL_DIALOG_SUBMIT_CHANNEL,
  serverUrlDialogSubmitRequestSchema,
  type ServerUrlDialogSubmitResponse,
} from "./server-url-dialog-ipc.js";
import {
  MAX_SERVER_NAME_LENGTH,
  normalizeCustomServerUrl,
  normalizeServerName,
} from "./server-target.js";

type ServerUrlDialogResult =
  | { kind: "cancelled" }
  | { kind: "clear" }
  | { kind: "set"; name: string | null; url: string };

type ServerUrlDialogMode = "add" | "edit" | "rename";

interface OpenServerUrlDialogArgs {
  initialName: string | null;
  initialUrl: string | null;
  mode: ServerUrlDialogMode;
  parentWindow: BrowserWindow | null;
  preloadPath: string;
}

const SERVER_URL_DIALOG_TITLES: Record<ServerUrlDialogMode, string> = {
  add: "Добавить сервер",
  edit: "Изменить сервер",
  rename: "Изменить сервер",
};

const SERVER_URL_DIALOG_DESCRIPTIONS: Record<ServerUrlDialogMode, string> = {
  add: "Сохраните ещё один сервер bb в меню «Сервер».",
  edit: "Измените сохранённый сервер. Чтобы удалить его, оставьте URL пустым.",
  rename:
    "Укажите имя сервера bb Connect. Адрес берётся из вашего аккаунта bb.",
};

function renderServerUrlDialogHtml(
  mode: ServerUrlDialogMode,
  initialUrl: string | null,
  initialName: string | null,
): string {
  const title = SERVER_URL_DIALOG_TITLES[mode];
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
  <title>${title}</title>
  <style>
${DESKTOP_DIALOG_BASE_CSS}

    input {
      background: Field;
      border: 1px solid color-mix(in srgb, CanvasText 24%, transparent);
      border-radius: 6px;
      box-sizing: border-box;
      color: FieldText;
      font-size: 13px;
      padding: 6px 8px;
      width: 100%;
    }

    input + input {
      margin-top: 8px;
    }

    [data-error] {
      color: #c0392b;
      font-size: 12px;
      line-height: 1.4;
      margin: 8px 0 0;
      min-height: 16px;
    }

    .actions {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
      margin-top: 12px;
    }

    button[type="submit"] {
      background: AccentColor;
      border-color: AccentColor;
      color: AccentColorText;
    }
  </style>
</head>
<body>
  <h1>${title}</h1>
  <p>${SERVER_URL_DIALOG_DESCRIPTIONS[mode]}</p>
  <form>
    <input name="url" type="text" placeholder="https://example.com:38886" value="${escapeHtmlText(initialUrl ?? "")}"${mode === "rename" ? " readonly" : ""} autocomplete="off" spellcheck="false">
    <input name="name" type="text" placeholder="Название (необязательно)" value="${escapeHtmlText(initialName ?? "")}" maxlength="${MAX_SERVER_NAME_LENGTH}" autocomplete="off" spellcheck="false">
    <div data-error></div>
    <div class="actions">
      <button type="button" data-cancel>Отмена</button>
      <button type="submit">Сохранить</button>
    </div>
  </form>
</body>
</html>`;
}

let openDialog: {
  result: Promise<ServerUrlDialogResult>;
  window: BrowserWindow;
} | null = null;

export function openServerUrlDialog(
  args: OpenServerUrlDialogArgs,
): Promise<ServerUrlDialogResult> {
  if (openDialog !== null && !openDialog.window.isDestroyed()) {
    openDialog.window.focus();
    return openDialog.result;
  }

  const dialogWindow = createDesktopDialogWindow({
    parentWindow: args.parentWindow,
    preloadPath: args.preloadPath,
    title: SERVER_URL_DIALOG_TITLES[args.mode],
    width: 440,
  });

  const result = new Promise<ServerUrlDialogResult>((resolvePromise) => {
    let settled = false;

    function finish(dialogResult: ServerUrlDialogResult): void {
      if (settled) {
        return;
      }
      settled = true;
      ipcMain.removeHandler(BB_DESKTOP_SERVER_URL_DIALOG_SUBMIT_CHANNEL);
      ipcMain.removeListener(
        BB_DESKTOP_SERVER_URL_DIALOG_CANCEL_CHANNEL,
        handleCancel,
      );
      openDialog = null;
      if (!dialogWindow.isDestroyed()) {
        dialogWindow.close();
      }
      resolvePromise(dialogResult);
    }

    function handleCancel(event: { sender: { id: number } }): void {
      if (event.sender.id === dialogWindow.webContents.id) {
        finish({ kind: "cancelled" });
      }
    }

    ipcMain.handle(
      BB_DESKTOP_SERVER_URL_DIALOG_SUBMIT_CHANNEL,
      (event, payload): ServerUrlDialogSubmitResponse => {
        if (event.sender.id !== dialogWindow.webContents.id) {
          return { ok: false, message: "Неожиданный отправитель." };
        }
        const parsed = serverUrlDialogSubmitRequestSchema.safeParse(payload);
        if (!parsed.success) {
          return { ok: false, message: "Введите корректный URL http(s)." };
        }
        if (args.mode === "rename" && args.initialUrl !== null) {
          finish({
            kind: "set",
            name: normalizeServerName(parsed.data.name),
            url: args.initialUrl,
          });
          return { ok: true };
        }
        if (parsed.data.url.trim().length === 0 && args.mode === "edit") {
          finish({ kind: "clear" });
          return { ok: true };
        }
        const normalized = normalizeCustomServerUrl(parsed.data.url);
        if (normalized === null) {
          return { ok: false, message: "Введите корректный URL http(s)." };
        }
        finish({
          kind: "set",
          name: normalizeServerName(parsed.data.name),
          url: normalized,
        });
        return { ok: true };
      },
    );
    ipcMain.on(BB_DESKTOP_SERVER_URL_DIALOG_CANCEL_CHANNEL, handleCancel);
    dialogWindow.on("closed", () => {
      finish({ kind: "cancelled" });
    });
  });

  openDialog = { result, window: dialogWindow };

  showDesktopDialogHtml(
    dialogWindow,
    renderServerUrlDialogHtml(args.mode, args.initialUrl, args.initialName),
  );

  return result;
}
