import {
  PluginCliError,
  cliCommand,
  defineCli,
  type BbPluginApi,
  type PluginCliResult,
} from "@get-bb/plugin-sdk";
import { AccountError, type AccountService } from "./account.js";
import type { AccountStatus, LoginView, SignOutResult } from "./contract.js";
import { HostedRequestError, RedeemError } from "./hosted.js";
import type { LinkLogins } from "./login.js";
import { resolveBaseUrl, type BaseUrlPolicy } from "./rpc.js";

const DESCRIPTION = [
  "Войдите в аккаунт getbb.app на этом bb. Плагин аккаунта bb хранит учётные данные сервера,",
  "которые используют удалённый доступ (bb connect) и облачные сервисы.",
  "",
  "  bb account login          Вывести ссылку getbb.app и код подтверждения",
  "  bb account login --wait   Дождаться завершения входа",
  "  bb account login --code <code>",
  "                            Привязать одноразовым кодом из панели управления",
].join("\n");

const JSON_OPTION = {
  type: "boolean",
  description: "Вывести JSON для программной обработки",
} as const;

const REDEEM_ERROR_TEXT: Record<RedeemError["code"], string> = {
  invalid_code:
    "код недействителен или истёк — получите новый в панели getbb.app",
  expired_code:
    "срок действия кода истёк — получите новый в панели getbb.app",
  already_used:
    "код уже использован — получите новый в панели getbb.app",
  network: "нет связи с getbb.app — проверьте подключение и повторите попытку",
};

const HOSTED_ERROR_TEXT: Partial<Record<HostedRequestError["code"], string>> = {
  rate_limited:
    "слишком много попыток входа из этой сети — подождите минуту и повторите попытку",
  unavailable:
    "getbb.app сейчас не может обработать запрос — повторите попытку через минуту",
};

function asJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function formatAccount(status: AccountStatus): string {
  if (status.state === "profile-pending") {
    return [
      "bb привязан к getbb.app, но данные аккаунта ещё не загружены; повторные попытки продолжаются.",
      "После загрузки заработают удалённый доступ и облачные сервисы. Проверьте подключение",
      "этой машины или выполните `bb account logout`, чтобы выйти и начать заново.",
    ].join("\n");
  }
  if (status.account === null) {
    return "Вход не выполнен. Выполните `bb account login`.";
  }
  const account = status.account;
  const login =
    account.githubLogin === null ? "" : ` (@${account.githubLogin})`;
  return [
    `Выполнен вход: ${account.name}${login}`,
    `  Имя пользователя:  ${account.handle ?? "пока нет"}`,
    `  Сервер:  ${account.serverLabel}  ${account.serverUrl}`,
  ].join("\n");
}

function formatPendingLogin(view: LoginView): string {
  const minutes = Math.max(
    0,
    Math.round((view.expiresAt - Date.now()) / 60_000),
  );
  return [
    "Для входа на этом bb откройте:",
    `  ${view.verificationUrl}`,
    `и подтвердите код ${view.userCode}. Он истечёт примерно через ${minutes} мин.`,
    "",
    "После подтверждения bb завершит вход автоматически. Чтобы дождаться",
    "результата здесь, выполните:",
    "  bb account login --wait",
  ].join("\n");
}

function formatSignOut(result: SignOutResult): string {
  switch (result.revocation) {
    case "not-signed-in":
      return "Вход не выполнен.";
    case "revoked":
      return "Вы вышли. Удалённый доступ и облачные сервисы остановлены до повторного входа.";
    case "failed":
      return [
        "На этом bb выполнен выход, но getbb.app не подтвердил отзыв доступа у сервера",
        `(${result.message}). Удалите сервер через ${result.dashboardUrl}.`,
      ].join("\n");
  }
}

function loginFailure(view: LoginView): PluginCliError {
  const reason = view.message ?? `sign-in ${view.state}`;
  return new PluginCliError(
    `${reason} Выполните \`bb account login\`, чтобы начать заново.`,
    { code: `login_${view.state.replace("-", "_")}` },
  );
}

function accountFailure(error: unknown): PluginCliError {
  if (error instanceof PluginCliError) return error;
  if (error instanceof RedeemError) {
    return new PluginCliError(REDEEM_ERROR_TEXT[error.code], {
      code: error.code,
    });
  }
  if (error instanceof AccountError) {
    return new PluginCliError(error.message, { code: error.code });
  }
  if (error instanceof HostedRequestError) {
    return new PluginCliError(HOSTED_ERROR_TEXT[error.code] ?? error.message, {
      code: error.code,
    });
  }
  return new PluginCliError(
    error instanceof Error ? error.message : String(error),
    { code: "account_failed" },
  );
}

async function attempt(
  work: () => Promise<PluginCliResult>,
): Promise<PluginCliResult> {
  try {
    return await work();
  } catch (error) {
    throw accountFailure(error);
  }
}

export function registerAccountCli(args: {
  bb: Pick<BbPluginApi, "cli">;
  account: AccountService;
  logins: LinkLogins;
  baseUrls: BaseUrlPolicy;
}): void {
  const { bb, account, logins, baseUrls } = args;
  bb.cli.register(
    defineCli({
      name: "account",
      summary: "Войти в аккаунт getbb.app на этом bb",
      description: DESCRIPTION,
      root: cliCommand({
        summary: "Показать инструкцию по входу",
        run: (input) => ({ exitCode: 0, stdout: input.help }),
      }),
      commands: {
        status: cliCommand({
          summary: "Показать, в какой аккаунт getbb.app вошёл этот bb",
          options: { json: JSON_OPTION },
          run: (input) => {
            const status = account.status();
            const login = logins.view(null);
            if (input.options.json) {
              return { exitCode: 0, stdout: asJson({ ...status, login }) };
            }
            const lines = [formatAccount(status)];
            if (login !== null && login.state === "pending") {
              lines.push(
                "",
                `Вход ожидает подтверждения: откройте ${login.verificationUrl} и подтвердите ${login.userCode}.`,
              );
            }
            return { exitCode: 0, stdout: `${lines.join("\n")}\n` };
          },
        }),
        login: cliCommand({
          summary: "Войти по ссылке getbb.app или привязать bb кодом",
          description:
            "Без --code команда выводит ссылку getbb.app и код для подтверждения в браузере. bb продолжает проверку и входит после подтверждения. --wait ожидает завершения входа. Новый вход заменяет текущий аккаунт bb.",
          options: {
            code: {
              type: "string",
              placeholder: "code",
              description: "Одноразовый код привязки из панели getbb.app",
            },
            wait: {
              type: "boolean",
              description:
                "Ждать подтверждения, отклонения или истечения кода входа, начатого командой `bb account login`",
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
            { kind: "at-most-one", options: ["code", "wait"] },
            { kind: "at-most-one", options: ["wait", "base-url"] },
          ],
          run: (input, ctx) =>
            attempt(async () => {
              const baseUrl = resolveBaseUrl(
                input.options["base-url"] ?? null,
                baseUrls,
              );
              if (input.options.code !== undefined) {
                const status = await logins.redeemCode(
                  input.options.code.trim(),
                  baseUrl,
                );
                return {
                  exitCode: 0,
                  stdout: input.options.json
                    ? asJson(status)
                    : `${formatAccount(status)}\n`,
                };
              }
              if (input.options.wait) {
                const view = await logins.wait(ctx.signal);
                if (view === null) {
                  throw new PluginCliError(
                    "вход не выполняется — сначала выполните `bb account login`",
                    { code: "no_login" },
                  );
                }
                if (view.state === "pending") {
                  throw new PluginCliError(
                    "ожидание прекращено; вход всё ещё открыт",
                    { code: "login_pending" },
                  );
                }
                if (view.state !== "signed-in") throw loginFailure(view);
                const status = account.status();
                return {
                  exitCode: 0,
                  stdout: input.options.json
                    ? asJson({ ...status, login: view })
                    : `${formatAccount(status)}\n`,
                };
              }
              const view = await logins.start(baseUrl);
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? asJson({ login: view, status: account.status() })
                  : `${formatPendingLogin(view)}\n`,
              };
            }),
        }),
        logout: cliCommand({
          summary: "Выйти и удалить привязку этого bb к getbb.app",
          description:
            "Отзывает учётные данные сервера на getbb.app, удаляет их здесь и отменяет ожидающий подтверждения вход. Удалённый доступ и облачные сервисы останавливаются до повторного входа. Если getbb.app недоступен, bb всё равно выполнит локальный выход; тогда удалите сервер через панель getbb.app.",
          options: { json: JSON_OPTION },
          run: (input) =>
            attempt(async () => {
              const result = await logins.signOut();
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? asJson(result)
                  : `${formatSignOut(result)}\n`,
              };
            }),
        }),
      },
    }),
  );
}
