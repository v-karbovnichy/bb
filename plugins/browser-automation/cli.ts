import {
  PluginCliError,
  cliCommand,
  defineCli,
  type PluginCliContext,
  type PluginCliRegistration,
  type PluginCliResult,
} from "@get-bb/plugin-sdk";
import type { z } from "zod";
import type { rpcContract } from "./contracts.js";

export type BrowserCliMethod =
  | "open"
  | "list"
  | "run"
  | "pages"
  | "screenshot"
  | "preview"
  | "stop"
  | "close";

export interface BrowserCliInput {
  threadId: string;
  sessionId?: string;
  selection?: z.input<typeof rpcContract.open.input>["selection"];
  script?: string;
  timeoutMs?: number;
  page?: string;
  afterSequence?: number;
}

export interface BrowserCliRequest {
  method: BrowserCliMethod;
  input: BrowserCliInput;
  scriptFile?: string;
  scriptHost?: string;
}

const SESSION_POSITIONAL = {
  name: "session-id",
  description: "ID сеанса, полученный от `bb browser-automation open`",
  required: true,
} as const;

const THREAD_OPTION = {
  type: "string",
  placeholder: "id",
  description:
    "Чат, которому принадлежит сеанс; по умолчанию текущий чат. Другой чат указать нельзя",
} as const;

const JSON_OPTION = {
  type: "boolean",
  description: "Вывести JSON для программной обработки",
} as const;

const REOPEN_HINT =
  "Откройте новый сеанс: `bb browser-automation open --backend <desktop|local> --machine <host-id>`.";

function resolveThreadId(
  option: string | undefined,
  ctx: PluginCliContext,
): string {
  const threadId = option ?? ctx.threadId;
  if (threadId === undefined || threadId === "") {
    throw new PluginCliError("Запустите команду из чата BB или укажите --thread <id>", {
      code: "thread_required",
    });
  }
  if (ctx.threadId !== undefined && threadId !== ctx.threadId) {
    throw new PluginCliError(
      "Команда из чата не может получить доступ к сеансу браузера другого чата",
      { code: "cross_thread" },
    );
  }
  return threadId;
}

export function createBrowserAutomationCli(deps: {
  execute(
    request: BrowserCliRequest,
    ctx: PluginCliContext,
  ): Promise<PluginCliResult>;
}): PluginCliRegistration {
  return defineCli({
    name: "browser-automation",
    summary: "Постоянные сеансы DevBrowser: настольные и без интерфейса",
    description:
      "Сеанс принадлежит открывшему его чату. run, pages и screenshot продлевают срок действия до 30 минут после использования, но не более чем до 8 часов с момента создания.\nНастольные сеансы также завершаются по истечении непродлеваемого срока управления или подключения (не более 30 минут).\nlist и просмотр в реальном времени не продлевают срок действия. Остановленный или истёкший сеанс нельзя возобновить; откройте новый.",
    commands: {
      open: cliCommand({
        summary:
          "Открыть настольный или локальный сеанс без интерфейса; --tab подключается к существующей вкладке",
        options: {
          backend: {
            type: "enum",
            values: ["desktop", "local"],
            required: true,
            description:
              "desktop управляет подключённым браузером; local запускает браузер без интерфейса на хосте",
          },
          machine: {
            type: "string",
            required: true,
            placeholder: "name-or-id",
            description:
              "Хост, запускающий браузер: точный ID или однозначное имя",
          },
          desktop: {
            type: "string",
            placeholder: "instance-id",
            description: "Экземпляр настольного браузера (только для desktop)",
          },
          tab: {
            type: "string",
            placeholder: "tab-id",
            description:
              "Существующая вкладка вместо открытия новой (только для desktop)",
          },
          headless: {
            type: "boolean",
            description: "Обязательно для local и недопустимо для desktop",
          },
          thread: THREAD_OPTION,
          json: JSON_OPTION,
        },
        run(input, ctx) {
          const threadId = resolveThreadId(input.options.thread, ctx);
          const hostId = input.options.machine;
          if (input.options.backend === "local") {
            if (
              !input.options.headless ||
              input.options.desktop !== undefined ||
              input.options.tab !== undefined
            ) {
              throw new PluginCliError(
                "Для локальных сеансов требуется --headless; настольные вкладки выбрать нельзя",
                { code: "invalid_selection" },
              );
            }
            return deps.execute(
              {
                method: "open",
                input: { threadId, selection: { backend: "local", hostId } },
              },
              ctx,
            );
          }
          const instanceId = input.options.desktop;
          if (instanceId === undefined || input.options.headless) {
            throw new PluginCliError(
              "Для настольных сеансов требуется --desktop <instance-id>; --headless недопустим",
              { code: "invalid_selection" },
            );
          }
          return deps.execute(
            {
              method: "open",
              input: {
                threadId,
                selection: {
                  backend: "desktop",
                  hostId,
                  instanceId,
                  ...(input.options.tab === undefined
                    ? {}
                    : { tabId: input.options.tab }),
                },
              },
            },
            ctx,
          );
        },
      }),
      list: cliCommand({
        summary: "Показать сеансы браузера этого чата",
        options: { thread: THREAD_OPTION, json: JSON_OPTION },
        run: (input, ctx) =>
          deps.execute(
            {
              method: "list",
              input: { threadId: resolveThreadId(input.options.thread, ctx) },
            },
            ctx,
          ),
      }),
      run: cliCommand({
        summary: "Выполнить доверенный скрипт DevBrowser; запуски в одном сеансе выполняются по очереди",
        description:
          "За один запуск скрипт может вернуть не более 4 снимков экрана в JPEG общим размером до 500 КБ;\nпревышение лимита или другой формат завершает запуск ошибкой.",
        positionals: [SESSION_POSITIONAL],
        constraints: [
          { kind: "exactly-one", options: ["script", "script-file"] },
          { kind: "requires", option: "script-file", needs: ["script-host"] },
          { kind: "requires", option: "script-host", needs: ["script-file"] },
          { kind: "at-most-one", options: ["timeout", "timeout-ms"] },
        ],
        options: {
          script: {
            type: "string",
            placeholder: "code",
            description: "Исходный код скрипта DevBrowser",
          },
          "script-file": {
            type: "string",
            placeholder: "path",
            description: "Файл скрипта, считываемый с --script-host",
          },
          "script-host": {
            type: "string",
            placeholder: "host-id",
            description: "Хост, на котором находится --script-file",
          },
          "timeout-ms": {
            type: "integer",
            min: 1000,
            max: 120_000,
            default: 30_000,
            description: "Тайм-аут запуска в миллисекундах",
          },
          timeout: {
            type: "duration",
            defaultUnit: "s",
            bareUnits: ["s", "ms"],
            min: 1000,
            max: 120_000,
            description:
              "Тайм-аут запуска как длительность (90s, 2m, 1500ms); число без единиц означает секунды (1–120) или миллисекунды (1000–120000)",
          },
          thread: THREAD_OPTION,
          json: JSON_OPTION,
        },
        run(input, ctx) {
          const threadId = resolveThreadId(input.options.thread, ctx);
          const scriptFile = input.options["script-file"];
          const scriptHost = input.options["script-host"];
          return deps.execute(
            {
              method: "run",
              input: {
                threadId,
                sessionId: input.positionals["session-id"],
                ...(input.options.script === undefined
                  ? {}
                  : { script: input.options.script }),
                timeoutMs: input.options.timeout ?? input.options["timeout-ms"],
              },
              ...(scriptFile === undefined ? {} : { scriptFile }),
              ...(scriptHost === undefined ? {} : { scriptHost }),
            },
            ctx,
          );
        },
      }),
      pages: cliCommand({
        summary: "Показать сохранённые именованные страницы",
        positionals: [SESSION_POSITIONAL],
        options: { thread: THREAD_OPTION, json: JSON_OPTION },
        run: (input, ctx) =>
          deps.execute(
            {
              method: "pages",
              input: {
                threadId: resolveThreadId(input.options.thread, ctx),
                sessionId: input.positionals["session-id"],
              },
            },
            ctx,
          ),
      }),
      screenshot: cliCommand({
        summary:
          "Сохранить JPEG ограниченного размера во временной папке сеанса; вернуть путь и ID хоста",
        positionals: [SESSION_POSITIONAL],
        options: {
          page: {
            type: "string",
            placeholder: "name",
            default: "main",
            description: "Именованная страница для снимка",
          },
          thread: THREAD_OPTION,
          json: JSON_OPTION,
        },
        run: (input, ctx) =>
          deps.execute(
            {
              method: "screenshot",
              input: {
                threadId: resolveThreadId(input.options.thread, ctx),
                sessionId: input.positionals["session-id"],
                page: input.options.page,
              },
            },
            ctx,
          ),
      }),
      preview: cliCommand({
        summary:
          "Описать текущий кадр локального сеанса без интерфейса, не возвращая данные изображения",
        positionals: [SESSION_POSITIONAL],
        options: {
          after: {
            type: "integer",
            min: 0,
            max: Number.MAX_SAFE_INTEGER,
            default: 0,
            description: "Показывать только кадры новее указанного порядкового номера",
          },
          thread: THREAD_OPTION,
          json: JSON_OPTION,
        },
        run: (input, ctx) =>
          deps.execute(
            {
              method: "preview",
              input: {
                threadId: resolveThreadId(input.options.thread, ctx),
                sessionId: input.positionals["session-id"],
                afterSequence: input.options.after,
              },
            },
            ctx,
          ),
      }),
      stop: cliCommand({
        summary:
          "Отменить ожидающие и выполняемые задачи и освободить управление; для продолжения откройте новый сеанс",
        positionals: [SESSION_POSITIONAL],
        options: { thread: THREAD_OPTION, json: JSON_OPTION },
        run: (input, ctx) =>
          deps.execute(
            {
              method: "stop",
              input: {
                threadId: resolveThreadId(input.options.thread, ctx),
                sessionId: input.positionals["session-id"],
              },
            },
            ctx,
          ),
      }),
      close: cliCommand({
        summary: "Закрыть принадлежащие сеансу браузеры и вкладки, сохранив переданные вкладки",
        positionals: [SESSION_POSITIONAL],
        options: { thread: THREAD_OPTION, json: JSON_OPTION },
        run: (input, ctx) =>
          deps.execute(
            {
              method: "close",
              input: {
                threadId: resolveThreadId(input.options.thread, ctx),
                sessionId: input.positionals["session-id"],
              },
            },
            ctx,
          ),
      }),
    },
  });
}

export function browserCliFailure(error: unknown): PluginCliError {
  if (error instanceof PluginCliError) return error;
  const message =
    error instanceof Error ? error.message : "Не удалось выполнить команду браузера";
  if (/stopped or expired|does not belong to this thread|остановлен или истёк|не принадлежит этому чату/u.test(message)) {
    return new PluginCliError(message, {
      code: "session_unavailable",
      hint: REOPEN_HINT,
    });
  }
  if (/screenshot|JPEG|снимок экрана|снимков экрана/iu.test(message)) {
    return new PluginCliError(message, {
      code: "screenshot_limit",
      hint: "Возвращайте не более 4 снимков экрана в JPEG за запуск, общим размером до 500 КБ.",
    });
  }
  return new PluginCliError(message, { code: "command_failed" });
}
