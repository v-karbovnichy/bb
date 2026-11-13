import {
  PluginCliError,
  cliCommand,
  defineCli,
  type BbPluginApi,
  type PluginCliResult,
} from "@get-bb/plugin-sdk";
import type { ConnectNextControls } from "./rpc.js";
import type { ConnectNextStatus } from "./types.js";

const NEXT_ADDRESS = "https://<label>.next.<account domain>";

const DESCRIPTION = [
  `Бета: доступ к этому bb также возможен по адресу ${NEXT_ADDRESS} через шлюз Fly.`,
  "Домен зависит от аккаунта bb: для getbb.app используется https://<label>.next.getbb.app.",
  "bb connect (https://<label>.getbb.app) продолжает работать; оба адреса доступны одновременно.",
  "",
  "Доступ включается, когда плагин активен и этот bb вошёл в ваш аккаунт",
  "(bb account login).",
  "",
  "`bb connect-next off` закрывает туннель connect next, не затрагивая bb connect;",
  "`bb connect-next on` открывает его снова.",
  "Порты сервера bb, открытые командой `bb connect expose <port>`, также доступны по адресу",
  "https://<label>--<port>.next.<account domain> (только владельцу); список показывает `bb connect-next status`.",
  "Порты других подключённых машин, открытые командой `bb connect expose <port> --host <machine>`, доступны по адресу",
  "https://<machine-label>--<port>.next.<account domain>; демон каждой машины запускает собственный туннель.",
].join("\n");

const JSON_OPTION = {
  type: "boolean",
  description: "Вывести JSON для программной обработки",
} as const;

const MACHINE_STATE_TEXT: Record<
  ConnectNextStatus["machines"][number]["state"],
  string
> = {
  idle: "ожидание",
  connecting: "подключение",
  connected: "подключено",
  refused: "учётные данные отклонены",
  offline: "не в сети",
  error: "ошибка",
};

const STATE_TEXT: Record<ConnectNextStatus["state"], string> = {
  off: "выключено",
  "signed-out": "ожидание входа в аккаунт bb",
  connecting: "подключение",
  connected: "подключено",
  refused: "учётные данные отклонены",
  offline: "не в сети",
  error: "ошибка",
};

export function formatStatus(status: ConnectNextStatus): string {
  if (!status.enabled) {
    return status.url === null
      ? "connect next выключен. Выполните `bb connect-next on` для доступа к bb по новому адресу."
      : `connect next выключен. Выполните \`bb connect-next on\` для доступа к bb по адресу ${status.url}.`;
  }
  if (status.label === null) {
    return "connect next включён, но этот bb не вошёл в аккаунт. Выполните `bb account login`; затем туннель запустится.";
  }
  const lines = [`${status.label}  ${status.url}  ${STATE_TEXT[status.state]}`];
  if (status.lastError !== null && status.state !== "connected") {
    lines.push(`  последняя ошибка: ${status.lastError}`);
  }
  if (status.nextRetryAt !== null && status.state !== "connected") {
    lines.push(`  следующая попытка: ${new Date(status.nextRetryAt).toISOString()}`);
  }
  lines.push(`  шлюз: ${status.server}`);
  for (const share of status.shares) {
    lines.push(
      `  порт ${share.port}  ${share.url}  ${share.state}${share.error === null ? "" : ` (${share.error})`}`,
    );
  }
  for (const machine of status.machines) {
    lines.push(
      `машина ${machine.hostName} (${machine.hostId})  ${machine.label ?? "метка пока не задана"}  ${MACHINE_STATE_TEXT[machine.state]}`,
    );
    if (machine.lastError !== null && machine.state !== "connected") {
      lines.push(`  последняя ошибка: ${machine.lastError}`);
    }
    for (const share of machine.shares) {
      lines.push(
        `  порт ${share.port}  ${share.url}  ${share.state}${share.error === null ? "" : ` (${share.error})`}`,
      );
    }
  }
  return lines.join("\n");
}

function asJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function attempt(
  work: () => Promise<PluginCliResult>,
): Promise<PluginCliResult> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof PluginCliError) throw error;
    throw new PluginCliError(
      error instanceof Error ? error.message : String(error),
      { code: "connect_next_failed" },
    );
  }
}

export function registerConnectNextCli(
  bb: Pick<BbPluginApi, "cli">,
  controls: ConnectNextControls,
): void {
  bb.cli.register(
    defineCli({
      name: "connect-next",
      summary: `Бета: доступ к этому bb также по адресу ${NEXT_ADDRESS}`,
      description: DESCRIPTION,
      commands: {
        status: cliCommand({
          summary: "Показать состояние туннеля connect next и адрес",
          options: { json: JSON_OPTION },
          run: (input) =>
            attempt(async () => {
              const status = controls.status();
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? asJson(status)
                  : `${formatStatus(status)}\n`,
              };
            }),
        }),
        on: cliCommand({
          summary: `Открыть доступ к bb также по адресу ${NEXT_ADDRESS}`,
          options: { json: JSON_OPTION },
          run: (input) =>
            attempt(async () => {
              const status = await controls.setEnabled(true);
              if (input.options.json) {
                return { exitCode: 0, stdout: asJson(status) };
              }
              return {
                exitCode: 0,
                stdout:
                  status.url === null
                    ? "connect next включён. Выполните `bb account login`; после входа туннель запустится.\n"
                    : `connect next включён — bb будет доступен по адресу ${status.url}\n`,
              };
            }),
        }),
        off: cliCommand({
          summary: "Закрыть туннель connect next, сохранив работу bb connect",
          options: { json: JSON_OPTION },
          run: (input) =>
            attempt(async () => {
              const status = await controls.setEnabled(false);
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? asJson(status)
                  : "connect next выключен. bb connect и локальный доступ продолжают работать.\n",
              };
            }),
        }),
      },
    }),
  );
}
