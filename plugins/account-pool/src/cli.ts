import {
  PluginCliError,
  cliCommand,
  defineCli,
  type BbPluginApi,
  type PluginCliResult,
} from "@get-bb/plugin-sdk";
import { setTimeout as wait } from "node:timers/promises";
import {
  accountAddInputSchema,
  accountIdInputSchema,
  accountPriorityInputSchema,
  accountReorderInputSchema,
  accountPoolConfigSetInputSchema,
  bypassInputSchema,
  codexLoginPollInputSchema,
  loginCompleteInputSchema,
  modelFamilySchema,
  parentModeSchema,
  tokenRotateInputSchema,
  routingSetInputSchema,
  type AccountPoolConfig,
  type AccountPoolConfigController,
  type AccountPoolConfigSetInput,
  type AccountSummary,
  type FamilyQuota,
  type LimitWindow,
  type LoginTarget,
  type ModelFamily,
  type PoolProvider,
  type PoolStatus,
  type PoolStatusReport,
} from "./contracts.js";
import type { PoolOperations } from "./operations.js";
import type { ClaudeOAuthLogin } from "./oauth-login.js";
import type { CodexDeviceLogin } from "./codex-device-login.js";

const DESCRIPTION = [
  "Аккаунты используются по очереди: сначала по приоритету, затем по порядку добавления. Текущий резервный аккаунт остаётся активным, пока доступен.",
  "switchThreshold задаёт предпочтение, а не жёсткий предел: новые чаты сначала направляются на аккаунты ниже порога, существующие сохраняют свой аккаунт, а аккаунты на пороге и выше продолжают работать до отказа провайдера. Статус исчерпания показывается только после отказа провайдера.",
  "Если этот сервер bb запущен внутри чата другого сервера bb, режим proxy направляет общий трафик через родительский сервер, а isolate отключает унаследованную маршрутизацию.",
  "При изменении порядка перечислите все аккаунты провайдера. Новый порядок применяется при следующем переключении; существующие чаты остаются закреплёнными.",
].join("\n");

const JSON_OPTION = {
  type: "boolean",
  description: "Вывести JSON для автоматической обработки",
} as const;

const PROVIDER_OPTION = {
  type: "enum",
  values: ["claude", "codex"],
  required: true,
  aliases: ["vendor"],
  description: "Провайдер этого аккаунта",
} as const;

const SESSION_OPTION = {
  type: "string",
  required: true,
  placeholder: "id",
  aliases: ["session-id", "sessionId"],
  description:
    "ID сессии, выведенный командой `bb pool account add --login` или `bb pool account login`",
} as const;

const ACCOUNT_ID_POSITIONAL = {
  name: "id",
  description: "UUID аккаунта из `bb pool account list`",
  required: true,
} as const;

function formatReset(value: number | null): string {
  return value === null ? "-" : new Date(value).toISOString();
}

function formatUtilization(value: number | null): string {
  return value === null ? "-" : `${Math.round(value * 100)}%`;
}

function familyLabel(family: ModelFamily): string {
  return family[0]?.toUpperCase() + family.slice(1);
}

function formatWindowLabel(window: LimitWindow): string {
  if (window.windowMinutes === null) return window.slot;
  if (window.windowMinutes % 1_440 === 0)
    return `${window.windowMinutes / 1_440}d`;
  if (window.windowMinutes % 60 === 0) return `${window.windowMinutes / 60}h`;
  return `${window.windowMinutes}m`;
}

function formatLimitWindows(windows: readonly LimitWindow[]): string {
  if (windows.length === 0) return "-";
  return windows
    .map(
      (window) =>
        `${formatWindowLabel(window)}=${formatUtilization(window.utilization)} ${formatReset(window.resetAt)}`,
    )
    .join("; ");
}

function formatFamilyQuota(quota: FamilyQuota | null): string {
  if (quota === null) return "-";
  return [
    formatUtilization(quota.utilization),
    quota.status ?? "-",
    formatReset(quota.resetAt),
    quota.source,
  ].join(" ");
}

function formatAccounts(accounts: readonly AccountSummary[]): string {
  if (accounts.length === 0) return "Аккаунты не настроены.";
  const families = modelFamilySchema.options.filter((family) =>
    accounts.some((account) => account.familyWeekly[family] !== null),
  );
  return [
    [
      "ID",
      "Название",
      "Эл. почта",
      "Провайдер",
      "Тип",
      "Включён",
      "Приоритет",
      "Периоды",
      "Доп. использование",
      ...families.map(familyLabel),
      "Статус",
    ].join("\t"),
    ...accounts.map((account) =>
      [
        account.id,
        account.label,
        account.email ?? "-",
        account.provider,
        account.kind,
        String(account.enabled),
        String(account.priority),
        formatLimitWindows(account.limitWindows),
        account.extraUsage?.status ?? "-",
        ...families.map((family) =>
          formatFamilyQuota(account.familyWeekly[family]),
        ),
        account.status,
      ].join("\t"),
    ),
  ].join("\n");
}

function formatStatus(status: PoolStatusReport): string {
  return [
    `Маршрут: ${status.route}`,
    `Приём запросов: ${status.accepting}`,
    `Включено аккаунтов: ${status.enabledAccountCount}`,
    `В обработке: ${status.inFlight}`,
    "",
    "Токены машин:",
    ...(status.hosts.length === 0
      ? ["Токены не созданы."]
      : status.hosts.map(
          (host) =>
            `${host.hostName ?? host.hostId}\t${new Date(host.mintedAt).toISOString()}\t${host.lastUsedAt === null ? "никогда" : new Date(host.lastUsedAt).toISOString()}`,
        )),
    "",
    "Недавние чаты без локального входа в Claude:",
    ...(status.routedThreadsWithoutLocalLogin.length === 0
      ? ["Нет."]
      : status.routedThreadsWithoutLocalLogin.map(
          (thread) =>
            `${thread.threadId}\t${thread.hostName ?? thread.hostId}\t${thread.localClaudeStatus}`,
        )),
    "",
    formatAccounts(status.accounts),
  ].join("\n");
}

function formatConfig(config: AccountPoolConfig): string {
  return [
    `anthropicUpstreamBaseUrl: ${config.anthropicUpstreamBaseUrl}`,
    `codexUpstreamBaseUrl: ${config.codexUpstreamBaseUrl}`,
    `switchThreshold: ${config.switchThreshold}`,
    `parentMode: ${config.parentMode}`,
  ].join("\n");
}

function formatParent(parent: PoolStatus["parent"]): string {
  if (parent === null) {
    return "Для этого экземпляра не обнаружен родительский сервер bb с пулом аккаунтов.";
  }
  return [
    `parent: ${parent.baseUrl}`,
    `mode: ${parent.mode}`,
    `parentServes.claude: ${parent.availability.claude}`,
    `parentServes.codex: ${parent.availability.codex}`,
  ].join("\n");
}

function parseConfigUpdate(
  key: string,
  value: string,
): AccountPoolConfigSetInput {
  if (key === "anthropicUpstreamBaseUrl") {
    return accountPoolConfigSetInputSchema.parse({
      anthropicUpstreamBaseUrl: value,
    });
  }
  if (key === "codexUpstreamBaseUrl") {
    return accountPoolConfigSetInputSchema.parse({
      codexUpstreamBaseUrl: value,
    });
  }
  if (key === "switchThreshold") {
    return accountPoolConfigSetInputSchema.parse({
      switchThreshold: Number(value),
    });
  }
  if (key === "parentMode") {
    return accountPoolConfigSetInputSchema.parse({ parentMode: value });
  }
  throw new PluginCliError(
    "Ключ настройки должен быть anthropicUpstreamBaseUrl, codexUpstreamBaseUrl, switchThreshold или parentMode.",
    { code: "invalid_value" },
  );
}

function json(value: object): string {
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
      { code: "pool_command_failed" },
    );
  }
}

export function registerPoolCli(
  bb: Pick<BbPluginApi, "cli">,
  operations: PoolOperations,
  login: ClaudeOAuthLogin,
  codexLogin: CodexDeviceLogin,
  config: AccountPoolConfigController,
): void {
  async function startLogin(
    provider: PoolProvider,
    target: LoginTarget,
    asJson: boolean,
  ): Promise<PluginCliResult> {
    if (provider === "codex") {
      const started = await codexLogin.start(target);
      return {
        exitCode: 0,
        stdout: asJson
          ? json({ ok: true, login: started })
          : `${[
              "Откройте эту ссылку для входа в Codex:",
              started.verificationUri,
              "",
              `Введите код: ${started.userCode}`,
              `ID сессии: ${started.sessionId}`,
              "",
              "После авторизации дождитесь сохранения входа с помощью команды:",
              `bb pool account login-poll --session ${started.sessionId}`,
            ].join("\n")}\n`,
      };
    }
    const started = await login.start(target);
    return {
      exitCode: 0,
      stdout: asJson
        ? json({ ok: true, login: started })
        : `${[
            "Откройте эту ссылку для входа в Claude:",
            started.authorizeUrl,
            "",
            `ID сессии: ${started.sessionId}`,
            "",
            "После входа передайте код с последней страницы в команду:",
            `printf '%s\\n' \"$CLAUDE_AUTH_CODE\" | bb pool account login-complete --session ${started.sessionId} --code-stdin`,
          ].join("\n")}\n`,
    };
  }
  bb.cli.register(
    defineCli({
      name: "pool",
      summary:
        "Управлять аккаунтами Claude и Codex и просматривать состояние пула",
      description: DESCRIPTION,
      commands: {
        "account add": cliCommand({
          summary:
            "Войти в аккаунт Claude или Codex либо добавить API-ключ Anthropic",
          description:
            "--login выводит шаг входа через браузер или код устройства и завершает работу; закончите вход командой `bb pool account login-complete` (Claude) или `bb pool account login-poll` (Codex).\nПул хранит отдельную сессию, поэтому вход на этой машине в Claude Code или Codex не влияет на него.",
          unexpectedPositionalHint:
            "укажите провайдера через --provider <claude|codex>",
          options: {
            provider: PROVIDER_OPTION,
            login: {
              type: "boolean",
              aliases: ["signin", "sign-in"],
              description:
                "Начать вход через браузер (Claude) или код устройства (Codex) и вывести следующую команду",
            },
            "api-key": {
              type: "string",
              placeholder: "key",
              stdin: true,
              aliases: ["apikey", "key"],
              description:
                "API-ключ Anthropic, только для --provider claude. Ключ будет виден в аргументах процесса, истории оболочки и журнале агента",
            },
            label: {
              type: "string",
              placeholder: "text",
              aliases: ["name"],
              description:
                "Название в списке; по умолчанию определяется по провайдеру",
            },
            priority: {
              type: "integer",
              min: -1_000_000,
              max: 1_000_000,
              default: 100,
              placeholder: "n",
              aliases: ["order"],
              description:
                "Порядок переключения: меньшие числа используются раньше, при равенстве сохраняется порядок добавления",
            },
            json: JSON_OPTION,
          },
          constraints: [{ kind: "exactly-one", options: ["login", "api-key"] }],
          run: (input) =>
            attempt(async () => {
              const provider = input.options.provider;
              if (input.options.login) {
                return startLogin(
                  provider,
                  {
                    kind: "add",
                    label: input.options.label ?? null,
                    priority: input.options.priority,
                  },
                  input.options.json === true,
                );
              }
              if (provider !== "claude") {
                throw new PluginCliError(
                  "Для API-ключа Anthropic требуется --provider claude.",
                  { code: "invalid_value" },
                );
              }
              const parsed = accountAddInputSchema.parse({
                provider,
                apiKey: input.options["api-key"],
                label: input.options.label ?? null,
                priority: input.options.priority,
              });
              const account = await operations.add(parsed);
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? json({ ok: true, account })
                  : `Добавлен аккаунт ${account.label} (${account.id}).\n`,
              };
            }),
        }),
        "account login": cliCommand({
          summary:
            "Повторно войти в аккаунт, сохранив его ID, приоритет, состояние и закреплённые чаты",
          description:
            "Используйте, если срок входа истёк, доступ отозван или сессия используется другой программой. Команда выводит шаг входа; завершите его через `bb pool account login-complete` (Claude) или `bb pool account login-poll` (Codex). Новый вход должен относиться к тому же аккаунту.",
          aliases: ["account relogin", "account reauth"],
          positionals: [ACCOUNT_ID_POSITIONAL],
          options: { json: JSON_OPTION },
          run: (input) =>
            attempt(async () => {
              const { id } = accountIdInputSchema.parse({
                id: input.positionals.id,
              });
              const account = (await operations.list()).find(
                (candidate) => candidate.id === id,
              );
              if (account === undefined) {
                throw new PluginCliError(`Аккаунт ${id} не найден.`, {
                  code: "account_not_found",
                });
              }
              return startLogin(
                account.provider,
                { kind: "relogin", accountId: id },
                input.options.json === true,
              );
            }),
        }),
        "account login-poll": cliCommand({
          summary: "Дождаться завершения входа в Codex по коду устройства",
          description:
            "Ожидает завершения или ошибки авторизации Codex либо отмены команды.",
          options: { session: SESSION_OPTION, json: JSON_OPTION },
          run: (input, ctx) =>
            attempt(async () => {
              const parsed = codexLoginPollInputSchema.parse({
                sessionId: input.options.session,
              });
              const signal = ctx.signal;
              const cancel = () => codexLogin.cancel(parsed);
              signal?.addEventListener("abort", cancel, { once: true });
              try {
                if (signal?.aborted) {
                  cancel();
                  throw (
                    signal.reason ?? new Error("Вход в Codex отменён.")
                  );
                }
                while (true) {
                  await wait(
                    codexLogin.nextPollDelayMs(parsed.sessionId),
                    undefined,
                    { signal },
                  );
                  const result = await codexLogin.poll(parsed);
                  if (signal?.aborted) {
                    throw (
                      signal.reason ?? new Error("Вход в Codex отменён.")
                    );
                  }
                  if (result.status === "complete") {
                    return {
                      exitCode: 0,
                      stdout: input.options.json
                        ? json({ ok: true, account: result.account })
                        : `Выполнен вход в ${result.account.label} (${result.account.id}).\n`,
                    };
                  }
                  if (result.status === "error") {
                    throw new PluginCliError(result.message, {
                      code: "codex_login_failed",
                    });
                  }
                }
              } catch (error) {
                if (signal?.aborted) codexLogin.cancel(parsed);
                throw error;
              } finally {
                signal?.removeEventListener("abort", cancel);
              }
            }),
        }),
        "account login-complete": cliCommand({
          summary: "Завершить вход в Claude через браузер с помощью кода",
          description:
            "Передайте код с последней страницы входа:\n  printf '%s\\n' \"$CLAUDE_AUTH_CODE\" | bb pool account login-complete --session <id> --code-stdin",
          options: {
            session: SESSION_OPTION,
            code: {
              type: "string",
              required: true,
              placeholder: "code",
              stdin: true,
              aliases: ["pasted", "auth-code"],
              description:
                "Код с последней страницы входа. Он будет виден в аргументах процесса",
            },
            json: JSON_OPTION,
          },
          run: (input) =>
            attempt(async () => {
              const parsed = loginCompleteInputSchema.parse({
                sessionId: input.options.session,
                pasted: input.options.code,
              });
              const account = await login.complete(parsed);
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? json({ ok: true, account })
                  : `Выполнен вход в ${account.label} (${account.id}).\n`,
              };
            }),
        }),
        "account list": cliCommand({
          summary: "Показать аккаунты пула и доступные квоты",
          aliases: ["account ls"],
          suggestFor: ["accounts", "list", "ls"],
          options: { json: JSON_OPTION },
          run: (input) =>
            attempt(async () => {
              const accounts = await operations.list();
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? json({ accounts })
                  : `${formatAccounts(accounts)}\n`,
              };
            }),
        }),
        "account remove": cliCommand({
          summary: "Удалить аккаунт и файл с его секретным токеном",
          aliases: ["account rm", "account delete"],
          positionals: [ACCOUNT_ID_POSITIONAL],
          options: { json: JSON_OPTION },
          run: (input) =>
            attempt(async () => {
              const { id } = accountIdInputSchema.parse({
                id: input.positionals.id,
              });
              if (!(await operations.remove(id))) {
                throw new PluginCliError(`Аккаунт ${id} не найден.`, {
                  code: "account_not_found",
                });
              }
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? json({ ok: true, removed: id })
                  : `Удалён аккаунт ${id}.\n`,
              };
            }),
        }),
        "account enable": cliCommand({
          summary: "Включить аккаунт",
          positionals: [ACCOUNT_ID_POSITIONAL],
          options: { json: JSON_OPTION },
          run: (input) =>
            attempt(async () => {
              const { id } = accountIdInputSchema.parse({
                id: input.positionals.id,
              });
              const account = await operations.enable(id);
              if (account === null) {
                throw new PluginCliError(`Аккаунт ${id} не найден.`, {
                  code: "account_not_found",
                });
              }
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? json({ ok: true, account })
                  : `Включён аккаунт ${id}.\n`,
              };
            }),
        }),
        "account disable": cliCommand({
          summary: "Отключить аккаунт",
          positionals: [ACCOUNT_ID_POSITIONAL],
          options: { json: JSON_OPTION },
          run: (input) =>
            attempt(async () => {
              const { id } = accountIdInputSchema.parse({
                id: input.positionals.id,
              });
              const account = await operations.disable(id);
              if (account === null) {
                throw new PluginCliError(`Аккаунт ${id} не найден.`, {
                  code: "account_not_found",
                });
              }
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? json({ ok: true, account })
                  : `Отключён аккаунт ${id}.\n`,
              };
            }),
        }),
        "account priority": cliCommand({
          summary: "Установить приоритет аккаунта при переключении",
          positionals: [
            ACCOUNT_ID_POSITIONAL,
            {
              name: "priority",
              description: "Целое число; меньшие числа используются раньше",
              required: true,
            },
          ],
          options: { json: JSON_OPTION },
          run: (input) =>
            attempt(async () => {
              const raw = input.positionals.priority;
              if (!/^-?\d+$/.test(raw.trim())) {
                throw new PluginCliError(
                  `недопустимое значение '${raw}' для <priority>. Требуется целое число`,
                  { code: "invalid_value" },
                );
              }
              const parsed = accountPriorityInputSchema.parse({
                accountId: input.positionals.id,
                priority: Number(raw),
              });
              const account = await operations.setPriority(
                parsed.accountId,
                parsed.priority,
              );
              if (account === null) {
                throw new PluginCliError("Аккаунт не найден.", {
                  code: "account_not_found",
                });
              }
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? json({ ok: true, account })
                  : `Для ${account.label} установлен приоритет ${account.priority}.\n`,
              };
            }),
        }),
        "account reorder": cliCommand({
          summary: "Задать полный порядок переключения для провайдера",
          description:
            "Перечислите все аккаунты провайдера, включая отключённые, в порядке их использования.",
          positionals: [
            {
              name: "provider",
              description: "claude or codex",
              required: true,
            },
            {
              name: "account-id",
              description: "UUID всех аккаунтов провайдера в нужном порядке",
              required: true,
              variadic: true,
            },
          ],
          options: { json: JSON_OPTION },
          run: (input) =>
            attempt(async () => {
              const parsed = accountReorderInputSchema.parse({
                provider: input.positionals.provider,
                accountIds: input.positionals["account-id"],
              });
              await operations.reorder(parsed.provider, parsed.accountIds);
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? json({
                      ok: true,
                      provider: parsed.provider,
                      accountIds: parsed.accountIds,
                    })
                  : `Обновлён порядок аккаунтов ${parsed.provider}.\n`,
              };
            }),
        }),
        "account refresh": cliCommand({
          summary:
            "Обновить данные об использовании аккаунта; повторить неудачный вход OAuth и очистить ошибку при успехе",
          positionals: [ACCOUNT_ID_POSITIONAL],
          options: { json: JSON_OPTION },
          run: (input) =>
            attempt(async () => {
              const { id } = accountIdInputSchema.parse({
                id: input.positionals.id,
              });
              const account = await operations.refreshUsage(id);
              if (account === null) {
                throw new PluginCliError("Аккаунт не найден.", {
                  code: "account_not_found",
                });
              }
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? json({ ok: true, account })
                  : account.error === null
                    ? `Обновлены данные об использовании ${id}.\n`
                    : `Для аккаунта ${id} ошибка сохраняется: ${account.error}\n`,
              };
            }),
        }),
        status: cliCommand({
          summary: "Показать состояние пула, токенов машин, маршрутизации и аккаунтов",
          suggestFor: ["info", "hub"],
          options: { json: JSON_OPTION },
          run: (input) =>
            attempt(async () => {
              const [poolStatus, routedThreadsWithoutLocalLogin] =
                await Promise.all([
                  operations.status(),
                  operations.routedThreadsWithoutLocalLogin(),
                ]);
              const status: PoolStatusReport = {
                ...poolStatus,
                routedThreadsWithoutLocalLogin,
              };
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? json(status)
                  : `${formatStatus(status)}\n`,
              };
            }),
        }),
        routing: cliCommand({
          summary: "Включить или отключить маршрутизацию через пул для провайдера",
          positionals: [
            {
              name: "provider",
              description: "claude or codex",
              required: true,
            },
          ],
          options: {
            off: {
              type: "boolean",
              aliases: ["disable"],
              description: "Отключить маршрутизацию через пул",
            },
            json: JSON_OPTION,
          },
          run: (input) =>
            attempt(async () => {
              const parsed = routingSetInputSchema.parse({
                provider: input.positionals.provider,
                enabled: !input.options.off,
              });
              await operations.setRouting(parsed.provider, parsed.enabled);
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? json({
                      ok: true,
                      provider: parsed.provider,
                      enabled: parsed.enabled,
                    })
                  : `Маршрутизация ${parsed.provider} через пул ${parsed.enabled ? "включена" : "отключена"}.\n`,
              };
            }),
        }),
        config: cliCommand({
          summary: "Показать настройки маршрутизации через пул",
          options: { json: JSON_OPTION },
          run: (input) =>
            attempt(async () => {
              const current = config.get();
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? json({ ok: true, config: current })
                  : `${formatConfig(current)}\n`,
              };
            }),
        }),
        "config set": cliCommand({
          summary: "Изменить одну настройку маршрутизации через пул",
          positionals: [
            {
              name: "key",
              description:
                "anthropicUpstreamBaseUrl, codexUpstreamBaseUrl, switchThreshold или parentMode",
              required: true,
            },
            {
              name: "value",
              description:
                "HTTP(S) URL вышестоящего сервера; для switchThreshold — число больше 0 и не больше 1 (доля квоты, при которой предпочтительны другие аккаунты); для parentMode — proxy или isolate",
              required: true,
            },
          ],
          options: { json: JSON_OPTION },
          run: (input) =>
            attempt(async () => {
              const next = await config.set(
                parseConfigUpdate(
                  input.positionals.key,
                  input.positionals.value,
                ),
              );
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? json({ ok: true, config: next })
                  : `${formatConfig(next)}\n`,
              };
            }),
        }),
        parent: cliCommand({
          summary:
            "Показать или изменить использование пула родительского сервера bb",
          positionals: [
            {
              name: "mode",
              description:
                "proxy направляет трафик пула через родительский сервер; isolate отключает унаследованную маршрутизацию. Не указывайте режим, чтобы посмотреть обнаруженный родительский сервер",
            },
          ],
          options: { json: JSON_OPTION },
          run: (input) =>
            attempt(async () => {
              const mode = input.positionals.mode;
              if (mode === undefined) {
                const status = await operations.status();
                return {
                  exitCode: 0,
                  stdout: input.options.json
                    ? json({ ok: true, parent: status.parent })
                    : `${formatParent(status.parent)}\n`,
                };
              }
              const parentMode = parentModeSchema.parse(mode);
              const next = await config.set({ parentMode });
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? json({ ok: true, parentMode: next.parentMode })
                  : `Для пула установлен родительский режим ${next.parentMode}.\n`,
              };
            }),
        }),
        "token rotate": cliCommand({
          summary: "Сменить токен доступа машины к пулу",
          description:
            "Предыдущий токен действует ещё десять минут. Токены не выводятся.",
          suggestFor: ["rotate", "token"],
          options: {
            machine: {
              type: "string",
              required: true,
              placeholder: "id-or-name",
              aliases: ["host", "host-id", "machine-id"],
              description:
                "Имя зарегистрированной машины или ID хоста из `bb pool status`",
            },
            json: JSON_OPTION,
          },
          run: (input) =>
            attempt(async () => {
              const { machine } = tokenRotateInputSchema.parse({
                machine: input.options.machine,
              });
              const token = await operations.rotateToken(machine);
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? json({ ok: true, token })
                  : `Токен пула для ${token.hostName ?? token.hostId} сменён.\n`,
              };
            }),
        }),
        bypass: cliCommand({
          summary: "Отключить маршрутизацию через пул для чата",
          positionals: [
            {
              name: "thread-id",
              description:
                "Чат, который должен использовать собственные учётные данные провайдера",
            },
          ],
          options: {
            off: {
              type: "boolean",
              aliases: ["disable"],
              description: "Восстановить маршрутизацию чата через пул",
            },
            json: JSON_OPTION,
          },
          run: (input, ctx) =>
            attempt(async () => {
              const threadId = input.positionals["thread-id"];
              if (threadId === undefined) {
                throw new PluginCliError(
                  "отсутствует обязательный аргумент: <thread-id>",
                  {
                    code: "missing_required",
                    ...(ctx.threadId === undefined
                      ? {}
                      : {
                          hint: `Текущий чат: ${ctx.threadId}; повторите команду bb pool bypass ${ctx.threadId}`,
                        }),
                  },
                );
              }
              const parsed = bypassInputSchema.parse({
                threadId,
                bypassed: !input.options.off,
              });
              const result = await operations.setBypass(
                parsed.threadId,
                parsed.bypassed,
              );
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? json({
                      ok: true,
                      threadId: result.threadId,
                      bypassed: result.bypassed,
                    })
                  : `Обход пула для ${result.threadId} ${result.bypassed ? "включён" : "отключён"}.\n`,
              };
            }),
        }),
      },
    }),
  );
}
