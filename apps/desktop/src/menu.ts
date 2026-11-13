import {
  app,
  Menu,
  shell,
  type BaseWindow,
  type MenuItemConstructorOptions,
} from "electron";
import type { BbDesktopZoomCommand } from "@bb/desktop-contract";
import type { ApplicationMenuAccelerators } from "./desktop-menu-shortcuts.js";
import { builtinServerName } from "./server-target.js";
import type { ConnectServerSyncSkipReason } from "./connect-server-sync.js";

const LOCAL_LOGS_MENU_LABEL = "Локальные журналы";
const OPEN_NEW_TAB_MENU_LABEL = "Новая вкладка";
const REOPEN_CLOSED_TAB_MENU_LABEL = "Открыть закрытую вкладку";
const NEW_THREAD_MENU_LABEL = "Новый чат";
const NEW_WINDOW_MENU_LABEL = "Новое окно";
const CLOSE_WINDOW_MENU_LABEL = "Закрыть окно";
const OPEN_SETTINGS_MENU_LABEL = "Настройки…";
const VIEW_LICENSE_MENU_LABEL = "Посмотреть лицензию";
const LICENSE_URL = "https://github.com/get-bb/bb/blob/main/LICENSE";
const UNINSTALL_MENU_LABEL = "Как удалить bb";
const UNINSTALL_URL = "https://getbb.app/uninstall";
const TOGGLE_DEVELOPER_TOOLS_MENU_LABEL = "Переключить инструменты разработчика";
const TOGGLE_DEVELOPER_TOOLS_ACCELERATOR = "Command+Option+I";
const RELOAD_ACCELERATOR = "CommandOrControl+R";
const FORCE_RELOAD_ACCELERATOR = "CommandOrControl+Shift+R";
const DESKTOP_SETTINGS_MENU_LABEL = "Настройки приложения";
const SERVER_MENU_LABEL = "Сервер";
const DESKTOP_SETTINGS_SERVER_MENU_ITEM_ID = "bb-desktop-settings-server-menu";
const WINDOW_SERVER_MENU_ITEM_ID = "bb-server-menu";
const SERVER_MENU_ITEM_IDS = [
  DESKTOP_SETTINGS_SERVER_MENU_ITEM_ID,
  WINDOW_SERVER_MENU_ITEM_ID,
];
export const SET_SERVER_URL_MENU_LABEL = "Изменить сервер…";
const CONNECT_SIGN_IN_MENU_LABELS: Partial<
  Record<ConnectServerSyncSkipReason, string>
> = {
  "no-credential": "Войти в bb Connect…",
  unauthorized: "Войти в bb Connect повторно…",
};

interface ApplicationMenuServerItem {
  checked: boolean;
  id: string;
  name: string;
}

export interface InstallApplicationMenuArgs {
  accelerators: ApplicationMenuAccelerators;
  isMac: boolean;
  showBuiltinServer: boolean;
  toggleBuiltinServer(): void;
  openAbout(): void;
  openNewTab(): void;
  openNewThread(): void;
  openSettings(): void;
  reopenClosedTab(): void;
  reloadWindow(
    browserWindow: BaseWindow | undefined,
    ignoreCache: boolean,
  ): void;
  zoomFocusedPage(command: BbDesktopZoomCommand): void;
  closeWindowOrSideTab(browserWindow: BaseWindow | undefined): void;
  createNewWindow(): void;
  openLocalLogs(): void;
  selectServer(serverId: string): void;
  setServerUrl(): void;
  signInToConnect(): void;
  addServer(): void;
  onServerMenuWillShow?: () => void;
  servers: ApplicationMenuServerItem[];
  connectServersSkipReason: ConnectServerSyncSkipReason | null;
}

function createLocalLogsMenuItems(
  args: InstallApplicationMenuArgs,
): MenuItemConstructorOptions[] {
  return [
    { type: "separator" },
    {
      label: LOCAL_LOGS_MENU_LABEL,
      click() {
        args.openLocalLogs();
      },
    },
  ];
}

export type ServerMenuArgs = Pick<
  InstallApplicationMenuArgs,
  | "isMac"
  | "showBuiltinServer"
  | "toggleBuiltinServer"
  | "addServer"
  | "connectServersSkipReason"
  | "selectServer"
  | "servers"
  | "setServerUrl"
  | "signInToConnect"
>;

export function createServerMenuItems(
  args: ServerMenuArgs,
): MenuItemConstructorOptions[] {
  const serverItems: MenuItemConstructorOptions[] = args.servers.map(
    (server) => ({
      checked: server.checked,
      click() {
        args.selectServer(server.id);
      },
      label: server.name,
      type: "radio" as const,
    }),
  );
  const signInLabel =
    args.connectServersSkipReason === null
      ? undefined
      : CONNECT_SIGN_IN_MENU_LABELS[args.connectServersSkipReason];
  return [
    ...serverItems,
    { type: "separator" },
    ...(signInLabel === undefined
      ? []
      : [
          {
            label: signInLabel,
            click() {
              args.signInToConnect();
            },
          },
        ]),
    {
      label: "Добавить сервер…",
      click() {
        args.addServer();
      },
    },
    {
      enabled: args.servers.some(
        (server) =>
          server.checked &&
          (server.id.startsWith("custom:") || server.id.startsWith("connect:")),
      ),
      label: SET_SERVER_URL_MENU_LABEL,
      click() {
        args.setServerUrl();
      },
    },
    { type: "separator" },
    {
      checked: args.showBuiltinServer,
      enabled: !args.servers.some(
        (server) => server.id === "builtin" && server.checked,
      ),
      label: `Показать ${builtinServerName(args.isMac ? "darwin" : "linux")}`,
      type: "checkbox",
      click() {
        args.toggleBuiltinServer();
      },
    },
  ];
}

export function buildApplicationMenuTemplate(
  args: InstallApplicationMenuArgs,
): MenuItemConstructorOptions[] {
  return [
    {
      label: app.name,
      submenu: [
        {
          label: `О приложении ${app.name}`,
          click() {
            args.openAbout();
          },
        },
        { type: "separator" },
        {
          accelerator: args.accelerators.openSettings,
          click() {
            args.openSettings();
          },
          label: OPEN_SETTINGS_MENU_LABEL,
        },
        {
          label: DESKTOP_SETTINGS_MENU_LABEL,
          submenu: [
            {
              id: DESKTOP_SETTINGS_SERVER_MENU_ITEM_ID,
              label: SERVER_MENU_LABEL,
              submenu: createServerMenuItems(args),
            },
          ],
        },
        { type: "separator" },
        ...(args.isMac
          ? [
              { role: "services" as const },
              { type: "separator" as const },
              { role: "hide" as const },
              { role: "hideOthers" as const },
              { role: "unhide" as const },
              { type: "separator" as const },
            ]
          : []),
        { role: "quit" },
      ],
    },
    {
      label: "Файл",
      submenu: [
        {
          accelerator: args.accelerators.openNewTab,
          click() {
            args.openNewTab();
          },
          label: OPEN_NEW_TAB_MENU_LABEL,
        },
        {
          accelerator: args.accelerators.reopenClosedTab,
          click() {
            args.reopenClosedTab();
          },
          label: REOPEN_CLOSED_TAB_MENU_LABEL,
        },
        {
          accelerator: args.accelerators.openNewThread,
          click() {
            args.openNewThread();
          },
          label: NEW_THREAD_MENU_LABEL,
        },
        {
          accelerator: args.accelerators.createNewWindow,
          click() {
            args.createNewWindow();
          },
          label: NEW_WINDOW_MENU_LABEL,
        },
        { type: "separator" },
        {
          accelerator: args.accelerators.closeWindowOrSideTab,
          click(_menuItem, browserWindow) {
            if (browserWindow === null) {
              if (args.isMac) {
                Menu.sendActionToFirstResponder("performClose:");
              }
              return;
            }
            args.closeWindowOrSideTab(browserWindow);
          },
          label: CLOSE_WINDOW_MENU_LABEL,
        },
      ],
    },
    {
      label: "Правка",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "Вид",
      submenu: [
        {
          accelerator: RELOAD_ACCELERATOR,
          label: "Обновить",
          registerAccelerator: false,
          click(_menuItem, browserWindow) {
            args.reloadWindow(browserWindow, false);
          },
        },
        {
          accelerator: FORCE_RELOAD_ACCELERATOR,
          label: "Обновить без кеша",
          registerAccelerator: false,
          click(_menuItem, browserWindow) {
            args.reloadWindow(browserWindow, true);
          },
        },
        {
          accelerator: args.isMac
            ? TOGGLE_DEVELOPER_TOOLS_ACCELERATOR
            : "Control+Shift+I",
          label: TOGGLE_DEVELOPER_TOOLS_MENU_LABEL,
          role: "toggleDevTools",
        },
        { type: "separator" },
        {
          accelerator: "CommandOrControl+0",
          label: "Исходный размер",
          click() {
            args.zoomFocusedPage("reset");
          },
        },
        {
          accelerator: "CommandOrControl+Plus",
          label: "Увеличить",
          click() {
            args.zoomFocusedPage("in");
          },
        },
        {
          accelerator: "CommandOrControl+-",
          label: "Уменьшить",
          click() {
            args.zoomFocusedPage("out");
          },
        },
        { type: "separator" },
        { role: "togglefullscreen" },
        ...createLocalLogsMenuItems(args),
      ],
    },
    {
      label: "Окно",
      submenu: [
        { role: "minimize" },
        ...(args.isMac ? [{ role: "zoom" as const }] : []),
        { type: "separator" },
        {
          id: WINDOW_SERVER_MENU_ITEM_ID,
          label: SERVER_MENU_LABEL,
          submenu: createServerMenuItems(args),
        },
        ...(args.isMac
          ? [{ type: "separator" as const }, { role: "front" as const }]
          : []),
      ],
    },
    {
      role: "help",
      label: "Справка",
      submenu: [
        {
          label: VIEW_LICENSE_MENU_LABEL,
          click: () => {
            void shell.openExternal(LICENSE_URL);
          },
        },
        {
          label: UNINSTALL_MENU_LABEL,
          click: () => {
            void shell.openExternal(UNINSTALL_URL);
          },
        },
      ],
    },
  ];
}

export function installApplicationMenu(args: InstallApplicationMenuArgs): void {
  const menu = Menu.buildFromTemplate(buildApplicationMenuTemplate(args));
  const onServerMenuWillShow = args.onServerMenuWillShow;
  if (onServerMenuWillShow !== undefined) {
    for (const id of SERVER_MENU_ITEM_IDS) {
      menu.getMenuItemById(id)?.submenu?.on("menu-will-show", () => {
        onServerMenuWillShow();
      });
    }
  }
  Menu.setApplicationMenu(menu);
}
