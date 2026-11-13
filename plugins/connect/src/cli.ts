import {
  PluginCliError,
  cliCommand,
  defineCli,
  type BbPluginApi,
  type PluginCliResult,
} from "@get-bb/plugin-sdk";
import {
  deriveConnectBaseUrl,
  mobilePairingPayload,
  type MobilePairingPayload,
} from "@bb/connect-client";
import {
  AccountUnavailableError,
  type AccountClient,
} from "bb-plugin-bb-account/src/client.js";
import { accountErrorCode } from "bb-plugin-bb-account/src/schemas.js";
import type { HostedConnectApi } from "./hosted.js";
import type { ShareHostResolver } from "./hosts.js";
import { MachineCodeError } from "./machine-code.js";
import type { RemoteAccessSwitch } from "./rpc.js";
import { parseSharePort } from "./shares.js";
import type { ConnectTunnel } from "./tunnel.js";
import type { ConnectStatus, ShareListing } from "./types.js";

const DESCRIPTION = [
  "Удалённый доступ через getbb.app — этот bb доступен по адресу https://<handle>.getbb.app.",
  "Открывайте HTTP-порты любой подключённой машины (только для сеанса владельца).",
  "",
  "  1. Войдите в аккаунт bb на этом сервере:",
  "       bb account login",
  "     (или вставьте код из панели: bb connect --code <code>; это также включает",
  "     удалённый доступ)",
  "  2. Удалённый доступ запустится автоматически и будет работать, пока работает bb.",
  "",
  "`bb connect off` выключает удалённый доступ, сохраняя вход в аккаунт;",
  "`bb connect on` включает его; `bb account logout` удаляет привязку.",
].join("\n");

const HOST_OPTION = {
  type: "string",
  placeholder: "имя-или-id",
  description: "Подключённая машина; по умолчанию машина чата",
} as const;

const JSON_OPTION = {
  type: "boolean",
  description: "Вывести JSON для программной обработки",
} as const;

const PAIR_ERROR_TEXT: Record<string, string> = {
  invalid_code:
    "код недействителен или истёк — получите новый в панели getbb.app",
  expired_code:
    "срок действия кода истёк — получите новый в панели getbb.app",
  already_used:
    "код уже использован — получите новый в панели getbb.app",
  network: "нет связи с getbb.app — проверьте подключение и повторите попытку",
  unauthorized:
    "getbb.app отклонил привязку — получите новый код в панели getbb.app и повторите попытку",
  profile_unavailable:
    "bb сохранил привязку, но getbb.app пока не вернул данные аккаунта — bb продолжает попытки; удалённый доступ заработает после получения данных (см. `bb account status`)",
  superseded:
    "эту попытку сменил другой вход или выход — выполните `bb account status`, чтобы узнать используемый аккаунт",
};

function shareLine(share: ShareListing): string {
  const address =
    share.url === ""
      ? `недоступно: ${share.unavailableReason ?? "причина неизвестна"}`
      : share.nextUrl === undefined
        ? share.url
        : `${share.url}  ${share.nextUrl}`;
  return `${share.hostName} (${share.hostId})  ${share.port}  ${address}`;
}

function formatStatus(status: ConnectStatus): string {
  if (!status.paired) {
    return "Вход в аккаунт bb не выполнен\nВыполните `bb account status`, чтобы узнать причину, или `bb account login` для входа; затем удалённый доступ запустится.";
  }
  if (!status.enabled) {
    return `${status.handle}  ${status.url}  выключено\nУдалённый доступ выключен. Выполните \`bb connect on\`, чтобы включить его.`;
  }
  const lines = [`${status.handle}  ${status.url}  ${status.state}`];
  if (status.lastError !== null && status.state !== "connected") {
    lines.push(`  последняя ошибка: ${status.lastError}`);
  }
  if (status.shares.length > 0) {
    lines.push("  открытые порты:");
    for (const share of status.shares) {
      lines.push(`    ${shareLine(share)}`);
    }
  }
  return lines.join("\n");
}

function asJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function notPairedError(): PluginCliError {
  return new PluginCliError(
    "этот bb не вошёл в аккаунт — выполните `bb account login`",
    { code: "not_paired" },
  );
}

function pairError(error: unknown): PluginCliError {
  if (error instanceof AccountUnavailableError) {
    return new PluginCliError(
      "плагин аккаунта bb не работает — включите его в «Настройки» → «Плагины» и повторите попытку",
      { code: "account_unavailable" },
    );
  }
  const code = accountErrorCode(error);
  return new PluginCliError(PAIR_ERROR_TEXT[code] ?? code, { code });
}

function machineCodeError(
  error: MachineCodeError,
  dashboardUrl: string,
): PluginCliError {
  switch (error.code) {
    case "not_paired":
      return notPairedError();
    case "machine_limit":
      return new PluginCliError(
        `для этого аккаунта достигнут лимит машин Connect — отзовите доступ у неиспользуемого устройства через ${dashboardUrl} и повторите попытку`,
        { code: "machine_limit" },
      );
    case "network":
      return new PluginCliError(
        "не удалось связаться с сервисом Connect для создания кода машины — проверьте подключение и повторите попытку",
        { code: "network" },
      );
  }
}

function formatMachineCode(payload: MobilePairingPayload): string {
  const minutes = Math.max(
    0,
    Math.round((payload.expiresAt - Date.now()) / 60_000),
  );
  return [
    `Код:        ${payload.code}`,
    `Сервер:     ${payload.serverUrl}`,
    `Основной домен: ${payload.apex}`,
    `Истекает:   ${new Date(payload.expiresAt).toISOString()} (примерно через ${minutes} мин)`,
    "",
    "Введите код в мобильном приложении bb при привязке через bb connect (или",
    "отсканируйте QR-код в «Настройки» → «Мобильное приложение» → «Добавить устройство»). Телефон",
    "добавится как машина Connect в этом аккаунте и появится в списке машин",
    "панели getbb.app, где можно отозвать доступ. Код действует один раз.",
  ].join("\n");
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
      { code: "connect_failed" },
    );
  }
}

export function registerConnectCli(args: {
  bb: Pick<BbPluginApi, "cli">;
  tunnel: ConnectTunnel;
  account: AccountClient;
  hosted: HostedConnectApi;
  hostResolver: ShareHostResolver;
  remoteAccess: RemoteAccessSwitch;
}): void {
  const { bb, tunnel, account, hosted, hostResolver, remoteAccess } = args;
  bb.cli.register(
    defineCli({
      name: "connect",
      summary:
        "Открыть доступ к bb по адресу https://<handle>.getbb.app после входа в аккаунт",
      description: DESCRIPTION,
      root: cliCommand({
        summary:
          "Войти с кодом из панели (bb account login --code) и включить удалённый доступ",
        options: {
          code: {
            type: "string",
            placeholder: "code",
            description:
              "Одноразовый код привязки из панели getbb.app; выполняет вход bb в аккаунт",
          },
          server: {
            type: "string",
            placeholder: "url",
            description:
              "Адрес сервера из панели: https://<handle>.getbb.app или https://<handle>.vibecodethis.site; используется только основной домен",
          },
          "base-url": {
            type: "string",
            placeholder: "url",
            description:
              "Источник getbb.app: https://getbb.app или https://vibecodethis.site (сборки для разработки также принимают http://bb.localhost:<port>)",
          },
          json: JSON_OPTION,
        },
        constraints: [
          { kind: "requires", option: "server", needs: ["code"] },
          { kind: "requires", option: "base-url", needs: ["code"] },
        ],
        run: (input) =>
          attempt(async () => {
            const code = input.options.code;
            if (code === undefined) {
              return { exitCode: 0, stdout: input.help };
            }
            const server = input.options.server;
            const baseUrl =
              input.options["base-url"] ??
              (server === undefined ? null : deriveConnectBaseUrl(server));
            let status: ConnectStatus;
            try {
              status = await tunnel.signIn(
                async () =>
                  (await account.redeemCode({ code: code.trim(), baseUrl }))
                    .account,
              );
            } catch (error) {
              const failure = pairError(error);
              if (failure.code === "profile_unavailable") {
                await remoteAccess.set(true);
              }
              throw failure;
            }
            if (!status.enabled) status = await remoteAccess.set(true);
            if (input.options.json) {
              return { exitCode: 0, stdout: asJson(status) };
            }
            return {
              exitCode: 0,
              stdout:
                `Привязан как ${status.handle} — доступен по адресу ${status.url}\n` +
                "Этот bb вошёл в ваш аккаунт (см. `bb account status`); туннель работает, пока работает bb.\n",
            };
          }),
      }),
      commands: {
        status: cliCommand({
          summary: "Показать состояние удалённого доступа",
          options: { json: JSON_OPTION },
          run: (input) =>
            attempt(async () => {
              const status = await tunnel.refreshStatus();
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? asJson(status)
                  : `${formatStatus(status)}\n`,
              };
            }),
        }),
        off: cliCommand({
          summary: "Выключить удалённый доступ, сохранив вход в аккаунт",
          description:
            "Закрывает туннель до выполнения `bb connect on`. Вход bb в аккаунт сохраняется; `bb account logout` удаляет привязку.",
          options: { json: JSON_OPTION },
          run: (input) =>
            attempt(async () => {
              const status = await remoteAccess.set(false);
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? asJson(status)
                  : "Удалённый доступ выключен. Вход bb в аккаунт сохраняется; выполните `bb connect on`, чтобы включить доступ, или `bb account logout`, чтобы удалить привязку.\n",
              };
            }),
        }),
        on: cliCommand({
          summary: "Снова включить удалённый доступ",
          options: { json: JSON_OPTION },
          run: (input) =>
            attempt(async () => {
              const status = await remoteAccess.set(true);
              if (input.options.json) {
                return { exitCode: 0, stdout: asJson(status) };
              }
              return {
                exitCode: 0,
                stdout: status.paired
                  ? `Удалённый доступ включён — bb доступен по адресу ${status.url}\n`
                  : "Удалённый доступ включён. Выполните `bb account login`; после входа туннель запустится.\n",
              };
            }),
        }),
        expose: cliCommand({
          summary: "Открыть HTTP-порт подключённой машины",
          positionals: [
            {
              name: "port",
              description: "Открываемый TCP-порт, 1–65535",
              required: true,
            },
          ],
          options: { host: HOST_OPTION, json: JSON_OPTION },
          run: (input, ctx) =>
            attempt(async () => {
              if (!tunnel.status().paired) throw notPairedError();
              const targetHost = await hostResolver.resolve(
                ctx,
                input.options.host,
              );
              const listing = await tunnel.expose(
                parseSharePort(input.positionals.port),
                targetHost,
              );
              if (input.options.json) {
                return { exitCode: 0, stdout: asJson(listing) };
              }
              return {
                exitCode: 0,
                stdout:
                  listing.nextUrl === undefined
                    ? `${listing.url}\n`
                    : `${listing.url}\n${listing.nextUrl}\n`,
              };
            }),
        }),
        unexpose: cliCommand({
          summary: "Закрыть HTTP-порт машины",
          positionals: [
            {
              name: "port",
              description: "Закрываемый TCP-порт",
              required: true,
            },
          ],
          options: { host: HOST_OPTION, json: JSON_OPTION },
          run: (input, ctx) =>
            attempt(async () => {
              const targetHost =
                input.options.host ?? (await hostResolver.resolveId(ctx));
              const result = await tunnel.unexpose(
                parseSharePort(input.positionals.port),
                targetHost,
              );
              if (input.options.json) {
                return { exitCode: 0, stdout: asJson(result) };
              }
              if (!result.removed) {
                return {
                  exitCode: 0,
                  stdout: `Порт ${result.port} не был открыт на ${result.hostName} (${result.hostId}); изменений нет.\n`,
                };
              }
              return {
                exitCode: 0,
                stdout: `Порт ${result.port} на ${result.hostName} (${result.hostId}) закрыт\n`,
              };
            }),
        }),
        "unexpose-all": cliCommand({
          summary: "Закрыть все HTTP-порты машины",
          options: {
            host: {
              type: "string",
              placeholder: "id",
              description: "ID машины; по умолчанию машина чата",
            },
            json: JSON_OPTION,
          },
          run: (input, ctx) =>
            attempt(async () => {
              const hostId =
                input.options.host ?? (await hostResolver.resolveId(ctx));
              const result = await tunnel.unexposeAll(hostId);
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? asJson(result)
                  : `На ${hostId} закрыто портов: ${result.removed}\n`,
              };
            }),
        }),
        shares: cliCommand({
          summary: "Показать открытые порты и их публичные адреса",
          suggestFor: ["list", "ls", "ports"],
          options: { host: HOST_OPTION, json: JSON_OPTION },
          run: (input, ctx) =>
            attempt(async () => {
              const targetHost = await hostResolver.resolve(
                ctx,
                input.options.host,
              );
              const shares = await tunnel.listShares(targetHost.id);
              if (input.options.json) {
                return {
                  exitCode: 0,
                  stdout: asJson({ host: targetHost, shares }),
                };
              }
              if (shares.length === 0) {
                return { exitCode: 0, stdout: "Нет открытых портов\n" };
              }
              const lines = shares.map(shareLine);
              return { exitCode: 0, stdout: `${lines.join("\n")}\n` };
            }),
        }),
        servers: cliCommand({
          summary: "Показать все серверы bb этого аккаунта",
          options: { json: JSON_OPTION },
          run: (input) =>
            attempt(async () => {
              const identity = tunnel.getIdentity();
              if (identity === null) throw notPairedError();
              const result = await hosted.listAccountServers(identity);
              if (input.options.json) {
                return { exitCode: 0, stdout: asJson(result) };
              }
              if (result.servers.length === 0) {
                return { exitCode: 0, stdout: "У этого аккаунта нет серверов\n" };
              }
              const handleWidth = Math.max(
                "ИМЯ".length,
                ...result.servers.map((server) => server.handle.length),
              );
              const nameWidth = Math.max(
                "НАЗВАНИЕ".length,
                ...result.servers.map((server) => server.name.length),
              );
              const urlWidth = Math.max(
                "URL".length,
                ...result.servers.map((server) => server.url.length),
              );
              const lines = [
                `${"ИМЯ".padEnd(handleWidth)}  ${"НАЗВАНИЕ".padEnd(nameWidth)}  ${"URL".padEnd(urlWidth)}  В СЕТИ  ЭТОТ`,
                ...result.servers.map((server) => {
                  const live = server.live ? "да" : "нет";
                  const self = server.handle === result.selfHandle ? "*" : "";
                  return `${server.handle.padEnd(handleWidth)}  ${server.name.padEnd(nameWidth)}  ${server.url.padEnd(urlWidth)}  ${live.padEnd(4)}  ${self}`;
                }),
              ];
              return { exitCode: 0, stdout: `${lines.join("\n")}\n` };
            }),
        }),
        "machine-code": cliCommand({
          summary:
            "Создать одноразовый код для добавления мобильного приложения bb как машины Connect",
          options: { json: JSON_OPTION },
          run: (input) =>
            attempt(async () => {
              if (tunnel.getIdentity() === null) throw notPairedError();
              let payload: MobilePairingPayload;
              try {
                payload = mobilePairingPayload(
                  await hosted.createMachineCode(AbortSignal.timeout(10_000)),
                );
              } catch (error) {
                if (error instanceof MachineCodeError) {
                  throw machineCodeError(error, tunnel.status().dashboardUrl);
                }
                throw error;
              }
              if (input.options.json) {
                return { exitCode: 0, stdout: asJson(payload) };
              }
              return { exitCode: 0, stdout: `${formatMachineCode(payload)}\n` };
            }),
        }),
      },
    }),
  );
}
