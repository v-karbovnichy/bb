import { isAbsolute } from "node:path";
import {
  experimental_resolveHostPath as resolveHostPath,
  experimental_getHostPathBasename as getHostPathBasename,
  PluginCliError,
  cliCommand,
  defineCli,
  type BbPluginApi,
  type PluginCliContext,
  type PluginCliResult,
} from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { AutomationService } from "./service.js";
import type {
  AgentEnvironment,
  AgentExecutionUpdate,
  AutomationDetailResponse,
  AutomationReadProblem,
  AutomationReadResult,
  AutomationResponse,
  AutomationRunResponse,
  AutomationScriptInterpreter,
  AutomationScriptWorkingDirectory,
  CreateAutomationInput,
  PermissionMode,
  ReasoningLevel,
  ResolvedCreateAutomationInput,
  ScriptExecutionUpdate,
  UpdateAutomationInput,
} from "./rpc-types.js";
import {
  providerRoutingForEnvironment,
  resolvePermissionMode,
} from "./provider-permissions.js";
import {
  AUTOMATION_RUNS_LIMIT_DEFAULT,
  AUTOMATION_RUNS_LIMIT_MAX,
  AUTOMATION_SCRIPT_MAX_LENGTH,
  AUTOMATION_SCRIPT_TIMEOUT_DEFAULT_MS,
  AUTOMATION_SCRIPT_TIMEOUT_MAX_MS,
} from "./limits.js";
import {
  automationScriptInterpreterSchema,
  permissionModeSchema,
  reasoningLevelSchema,
} from "./rpc-types.js";
import { interpreterForPath } from "./script-files.js";

const DURATION_PATTERN =
  /^(\d+)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)$/iu;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

const DESCRIPTION = `Автоматизации выполняют запросы агентов или серверные скрипты по расписанию.

Скрипты запускаются на хосте сервера bb. Новые скрипты обычных проектов
используют исходный каталог проекта на этом хосте, если он доступен. Скрипты
личных проектов и проектов без такого каталога запускаются из общей папки
хранения скриптов плагина. Там же запускаются существующие скрипты без
сохранённых настроек папки. Укажите automation-storage, project или абсолютный
путь на хосте сервера через --working-directory. Если выбранная папка
недоступна, запуск завершится ошибкой.`;

const JSON_OPTION = {
  type: "boolean",
  description: "Вывести машиночитаемый JSON",
} as const;

const PROJECT_OPTION = {
  type: "string",
  placeholder: "id",
  description:
    "Обязательно. Проект автоматизации; команда `bb project list --include-personal --json` показывает идентификаторы",
} as const;

const AUTOMATION_ID_POSITIONAL = {
  name: "automationId",
  description: "Идентификатор автоматизации из `bb automation list`",
  required: true,
} as const;

const SCHEDULE_OPTIONS = {
  cron: {
    type: "string",
    placeholder: "expression",
    description:
      "Выражение cron из пяти полей, до 100 символов; требует --timezone",
  },
  timezone: {
    type: "string",
    placeholder: "iana-timezone",
    description:
      "Часовой пояс IANA для --cron, например America/New_York; используется только с --cron",
  },
  at: {
    type: "string",
    placeholder: "datetime",
    description:
      "Время разового запуска в будущем, желательно в формате ISO 8601 (2026-01-31T09:00:00Z)",
  },
  in: {
    type: "string",
    placeholder: "duration",
    description: "Задержка разового запуска от текущего времени: 30s, 5m, 2h или 1d",
  },
} as const;

const AGENT_OPTIONS = {
  prompt: {
    type: "string",
    placeholder: "text",
    description: "Запрос, который агент выполнит при срабатывании автоматизации",
  },
  provider: {
    type: "string",
    placeholder: "id",
    description: "Идентификатор провайдера, например claude-code или codex",
  },
  model: {
    type: "string",
    placeholder: "model",
    description: "Идентификатор модели, поддерживаемый провайдером",
  },
  reasoning: {
    type: "string",
    placeholder: "level",
    description:
      "Идентификатор уровня рассуждений модели, например low, medium или high; по умолчанию medium",
  },
  "service-tier": {
    type: "string",
    placeholder: "tier",
    description:
      "Идентификатор уровня сервиса модели, например default или fast",
  },
  "clear-service-tier": {
    type: "boolean",
    description: "Не задавать уровень сервиса автоматизации",
  },
  "permission-mode": {
    type: "enum",
    values: permissionModeSchema.options,
    description:
      "Режим разрешений; по умолчанию лучший доступный у провайдера: сначала auto, затем full",
  },
  "target-thread": {
    type: "string",
    placeholder: "thread-id",
    description: "Отправить запрос в существующий чат вместо создания нового",
  },
  environment: {
    type: "string",
    placeholder: "id-or-path",
    description:
      "Идентификатор существующего окружения или путь к рабочему пространству на машине чата; иначе используется основной хост",
  },
  "new-environment": {
    type: "enum",
    values: ["worktree"],
    description: "Создавать новое окружение этого типа для каждого запуска",
  },
  "base-branch": {
    type: "string",
    placeholder: "branch",
    description: "Базовая ветка для рабочего дерева --new-environment",
  },
} as const;

const SCRIPT_OPTIONS = {
  script: {
    type: "string",
    placeholder: "inline",
    description: `Текст скрипта, до ${AUTOMATION_SCRIPT_MAX_LENGTH} символов`,
  },
  "script-file": {
    type: "string",
    placeholder: "path",
    description:
      "Скопировать скрипт из файла; относительные пути отсчитываются от текущей папки вызова",
  },
  host: {
    type: "string",
    placeholder: "name-or-id",
    description:
      "Хост файла --script-file; по умолчанию хост окружения чата, иначе хост сервера",
  },
  interpreter: {
    type: "enum",
    values: automationScriptInterpreterSchema.options,
    description:
      "Интерпретатор скрипта; для нового скрипта определяется по расширению --script-file, при обновлении сохраняется текущий",
  },
  timeout: {
    type: "duration",
    defaultUnit: "ms",
    min: 1,
    max: AUTOMATION_SCRIPT_TIMEOUT_MAX_MS,
    description: `Максимальное время выполнения; число без единиц считается миллисекундами (по умолчанию ${AUTOMATION_SCRIPT_TIMEOUT_DEFAULT_MS}, максимум ${AUTOMATION_SCRIPT_TIMEOUT_MAX_MS})`,
  },
  "env-json": {
    type: "string",
    placeholder: "json",
    description:
      'Переменные окружения скрипта в виде JSON-объекта строк, например {"CHANNEL":"qa"}',
  },
  "working-directory": {
    type: "string",
    placeholder: "automation-storage|project|path",
    description:
      "Папка запуска скрипта: automation-storage, project или абсолютный путь на хосте сервера bb",
  },
} as const;

interface ScheduleOptionValues {
  cron: string | undefined;
  timezone: string | undefined;
  at: string | undefined;
  in: string | undefined;
}

interface AgentOptionValues {
  prompt: string | undefined;
  provider: string | undefined;
  model: string | undefined;
  reasoning: ReasoningLevel | undefined;
  "service-tier": string | undefined;
  "clear-service-tier": boolean | undefined;
  "permission-mode": PermissionMode | undefined;
  "target-thread": string | undefined;
  environment: string | undefined;
  "new-environment": "worktree" | undefined;
  "base-branch": string | undefined;
}

interface ScriptOptionValues {
  script: string | undefined;
  "script-file": string | undefined;
  host: string | undefined;
  interpreter: AutomationScriptInterpreter | undefined;
  timeout: number | undefined;
  "env-json": string | undefined;
  "working-directory": string | undefined;
}

type ExecutionOptionValues = AgentOptionValues & ScriptOptionValues;

type UpdateOptionValues = ExecutionOptionValues &
  ScheduleOptionValues & {
    project: string | undefined;
    name: string | undefined;
  };

function cliError(message: string, code: string): PluginCliError {
  return new PluginCliError(message, { code });
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
      { code: "automation_failed" },
    );
  }
}

function jsonOutput(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function requireProjectId(
  value: string | undefined,
  ctx: Pick<PluginCliContext, "projectId">,
): string {
  if (value !== undefined && value !== "") return value;
  const known = ctx.projectId;
  throw new PluginCliError("отсутствует обязательный параметр --project", {
    code: "missing_required",
    hint:
      known === undefined
        ? "Укажите --project <id>; команда `bb project list --include-personal --json` показывает идентификаторы проектов."
        : `Проект этого чата: ${known}; повторите команду с --project ${known}`,
  });
}

function requireOptionValue(name: string, value: string): string {
  if (value === "") {
    throw cliError(
      `Отсутствует обязательный параметр --${name} <value>.`,
      "missing_required",
    );
  }
  return value;
}

function parseRunAt(value: string): number {
  if (DATE_ONLY_PATTERN.test(value.trim())) {
    throw cliError(
      "Для --at требуется время суток, например 2026-08-25T09:00; одна дата не определяет часовой пояс.",
      "invalid_value",
    );
  }
  const runAt = Date.parse(value);
  if (!Number.isFinite(runAt)) {
    throw cliError(
      "Значение --at должно быть корректной датой и временем, желательно в формате ISO 8601.",
      "invalid_value",
    );
  }
  if (runAt <= Date.now()) {
    throw cliError("Значение --at должно быть в будущем.", "invalid_value");
  }
  return runAt;
}

function parseRunIn(value: string): number {
  const match = DURATION_PATTERN.exec(value.trim());
  if (!match) {
    throw cliError(
      "Значение --in должно быть длительностью, например 30s, 5m, 2h или 1d.",
      "invalid_value",
    );
  }
  const amount = Number.parseInt(match[1] ?? "", 10);
  if (amount <= 0) {
    throw cliError("Значение --in должно быть больше нуля.", "invalid_value");
  }
  const unit = (match[2] ?? "").toLowerCase();
  const multiplier = unit.startsWith("s")
    ? 1_000
    : unit.startsWith("m")
      ? 60_000
      : unit.startsWith("h")
        ? 60 * 60_000
        : 24 * 60 * 60_000;
  return Date.now() + amount * multiplier;
}

function buildTrigger(
  options: ScheduleOptionValues,
): CreateAutomationInput["trigger"] {
  const { cron, at, in: runIn, timezone } = options;
  const triggerFlags = [cron, at, runIn].filter(
    (value) => value !== undefined,
  ).length;
  if (triggerFlags !== 1) {
    throw cliError(
      "Укажите ровно один параметр расписания: --cron, --at или --in.",
      "missing_required",
    );
  }
  if (cron !== undefined) {
    if (!timezone)
      throw cliError("Для --cron требуется --timezone.", "missing_required");
    return { triggerType: "schedule", cron, timezone };
  }
  if (timezone !== undefined) {
    throw cliError(
      "--timezone используется только с --cron.",
      "unexpected_argument",
    );
  }
  if (at !== undefined) return { triggerType: "once", runAt: parseRunAt(at) };
  if (runIn !== undefined) {
    return { triggerType: "once", runAt: parseRunIn(runIn) };
  }
  throw cliError(
    "Укажите ровно один параметр расписания: --cron, --at или --in.",
    "missing_required",
  );
}

function parseScriptWorkingDirectory(
  raw: string,
): AutomationScriptWorkingDirectory {
  const value = requireOptionValue("working-directory", raw);
  if (value === "automation-storage" || value === "project") {
    return { type: value };
  }
  if (isAbsolute(value)) return { type: "path", path: value };
  throw cliError(
    "Недопустимое значение --working-directory. Ожидается automation-storage, project или абсолютный путь на хосте сервера bb.",
    "invalid_value",
  );
}

function validateAgentTargetOptions(options: AgentOptionValues): void {
  if (options["clear-service-tier"] && options["service-tier"] !== undefined) {
    throw cliError(
      "Нельзя одновременно указать --service-tier и --clear-service-tier.",
      "unexpected_argument",
    );
  }
  const targetThread = options["target-thread"];
  const environment = options.environment;
  const newEnvironment = options["new-environment"];
  if (targetThread !== undefined) {
    requireOptionValue("target-thread", targetThread);
  }
  if (environment !== undefined) requireOptionValue("environment", environment);
  const provided = [targetThread, environment, newEnvironment].filter(
    (value) => value !== undefined,
  );
  if (provided.length > 1) {
    throw cliError(
      "Нельзя одновременно указывать параметры цели --target-thread, --environment и --new-environment.",
      "unexpected_argument",
    );
  }
  if (
    options["base-branch"] !== undefined &&
    options["new-environment"] === undefined
  ) {
    throw cliError(
      "Для --base-branch требуется --new-environment worktree.",
      "missing_required",
    );
  }
}

function parseScriptEnv(
  value: string | undefined,
): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  let decoded: unknown;
  try {
    decoded = JSON.parse(value);
  } catch {
    throw cliError(
      "--env-json должен быть JSON-объектом со строковыми значениями.",
      "invalid_value",
    );
  }
  const parsed = z.record(z.string(), z.string()).safeParse(decoded);
  if (!parsed.success) {
    throw cliError(
      "--env-json должен быть JSON-объектом со строковыми значениями.",
      "invalid_value",
    );
  }
  return parsed.data;
}

function looksLikePath(value: string): boolean {
  return (
    value.includes("/") ||
    value.includes("\\") ||
    /^[A-Za-z]:/u.test(value) ||
    value.startsWith(".") ||
    value.startsWith("~")
  );
}

async function resolveAgentHostId(
  bb: Pick<BbPluginApi, "sdk">,
  ctx: Pick<PluginCliContext, "threadId">,
): Promise<string> {
  const threadHostId =
    ctx.threadId === undefined
      ? null
      : await readThreadHostId(bb, ctx.threadId);
  if (threadHostId !== null) return threadHostId;
  const { primaryHostId } = await bb.sdk.system.config();
  if (primaryHostId === null) {
    throw cliError("Основной хост недоступен.", "no_connected_host");
  }
  return primaryHostId;
}

async function buildAgentEnvironment(
  bb: Pick<BbPluginApi, "sdk">,
  options: AgentOptionValues,
  ctx: Pick<PluginCliContext, "threadId">,
): Promise<AgentEnvironment> {
  const environment = options.environment?.trim();
  const newEnvironment = options["new-environment"];
  const baseBranch = options["base-branch"]?.trim();
  if (environment && newEnvironment) {
    throw cliError(
      "Нельзя одновременно указать --environment и --new-environment.",
      "unexpected_argument",
    );
  }
  if (newEnvironment) {
    return {
      type: "host",
      hostId: await resolveAgentHostId(bb, ctx),
      workspace: {
        type: "managed-worktree",
        baseBranch: baseBranch
          ? { kind: "named", name: baseBranch }
          : { kind: "default" },
      },
    };
  }
  if (!environment) return { type: "project-default" };
  if (looksLikePath(environment)) {
    return {
      type: "host",
      hostId: await resolveAgentHostId(bb, ctx),
      workspace: { type: "unmanaged", path: environment },
    };
  }
  return { type: "reuse", environmentId: environment };
}

const scriptFileHostListSchema = z.array(
  z.object({ id: z.string().min(1), name: z.string().min(1) }).passthrough(),
);
const threadEnvironmentHostSchema = z
  .object({
    environment: z
      .object({ hostId: z.string().min(1) })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();

async function readThreadHostId(
  bb: Pick<BbPluginApi, "sdk">,
  threadId: string,
): Promise<string | null> {
  const thread = threadEnvironmentHostSchema.parse(
    await bb.sdk.threads.get({ threadId, include: "environment" }),
  );
  return thread.environment?.hostId ?? null;
}

async function resolveScriptFileHostId(
  bb: Pick<BbPluginApi, "sdk">,
  ctx: Pick<PluginCliContext, "threadId">,
  override: string | undefined,
): Promise<string | undefined> {
  if (override !== undefined) {
    const query = override.trim();
    if (query.length === 0) {
      throw cliError("Для --host требуется название или идентификатор.", "invalid_value");
    }
    const hosts = scriptFileHostListSchema.parse(await bb.sdk.hosts.list());
    const idMatch = hosts.find((host) => host.id === query);
    if (idMatch) return idMatch.id;
    const nameMatches = hosts.filter(
      (host) => host.name.toLocaleLowerCase() === query.toLocaleLowerCase(),
    );
    if (nameMatches.length === 1) return nameMatches[0]!.id;
    if (nameMatches.length > 1) {
      throw cliError(
        `Имя хоста «${query}» неоднозначно; укажите один из идентификаторов: ${nameMatches
          .map((host) => host.id)
          .join(", ")}`,
        "invalid_value",
      );
    }
    throw cliError(
      `Неизвестный хост «${query}»; список хостов: \`bb machine list\`.`,
      "invalid_value",
    );
  }
  if (ctx.threadId === undefined) return undefined;
  const hostId = await readThreadHostId(bb, ctx.threadId);
  if (hostId === null) {
    throw cliError(
      `У чата ${ctx.threadId} нет окружения, поэтому хост --script-file определить нельзя; укажите --host <name-or-id>.`,
      "invalid_value",
    );
  }
  return hostId;
}

type ScriptFileSource = {
  path: string;
  fileName: string;
  hostId: string | undefined;
  content: string;
};

async function loadScriptFileSource(
  bb: Pick<BbPluginApi, "sdk">,
  options: ScriptOptionValues,
  ctx: Pick<PluginCliContext, "cwd" | "threadId">,
): Promise<ScriptFileSource | undefined> {
  const scriptFile = options["script-file"];
  const hostOverride = options.host;
  if (scriptFile === undefined) {
    if (hostOverride !== undefined) {
      throw cliError("Для --host требуется --script-file.", "missing_required");
    }
    return undefined;
  }
  const path = resolveHostPath({ rootPath: ctx.cwd ?? "", path: scriptFile });
  if (path === null) {
    throw cliError(
      "Недопустимый путь --script-file; для относительного пути нужна текущая папка вызова CLI.",
      "invalid_value",
    );
  }
  const fileName = getHostPathBasename(path);
  if (!fileName) {
    throw cliError(`--script-file должен указывать на файл: ${path}`, "invalid_value");
  }
  const hostId = await resolveScriptFileHostId(bb, ctx, hostOverride);
  const file = await bb.sdk.files.read({
    ...(hostId !== undefined ? { hostId } : {}),
    path,
  });
  if (file.contentEncoding !== "utf8") {
    throw cliError(`--script-file не содержит текст UTF-8: ${path}`, "invalid_value");
  }
  return { path, fileName, hostId, content: file.content };
}

type BuiltExecution = {
  execution: ResolvedCreateAutomationInput["execution"];
  scriptSource?: ScriptFileSource;
};

async function buildExecution(
  bb: Pick<BbPluginApi, "sdk">,
  options: ExecutionOptionValues,
  ctx: Pick<PluginCliContext, "cwd" | "threadId">,
): Promise<BuiltExecution> {
  const prompt = options.prompt;
  const script = options.script;
  const scriptFile = options["script-file"];
  const hasAgent = prompt !== undefined;
  const hasScript = script !== undefined || scriptFile !== undefined;
  if (hasAgent && hasScript) {
    throw cliError(
      "Укажите параметры агента (--prompt) или скрипта (--script/--script-file), но не оба набора.",
      "unexpected_argument",
    );
  }
  if (
    hasAgent &&
    (options.interpreter !== undefined ||
      options.timeout !== undefined ||
      options["env-json"] !== undefined ||
      options["working-directory"] !== undefined)
  ) {
    throw cliError(
      "Автоматизации агента не принимают --interpreter, --timeout, --env-json и --working-directory.",
      "unexpected_argument",
    );
  }
  if (!hasAgent && !hasScript) {
    throw cliError(
      "Укажите режим выполнения: агент (--prompt --provider --model) или скрипт (--script-file <path> либо --script <inline>).",
      "missing_required",
    );
  }
  if (hasAgent) {
    const provider = options.provider;
    const model = options.model;
    if (!provider || !model) {
      throw cliError(
        "Для автоматизации агента вместе с --prompt нужны --provider и --model.",
        "missing_required",
      );
    }
    validateAgentTargetOptions(options);
    const environment = await buildAgentEnvironment(bb, options, ctx);
    const serviceTier = options["service-tier"];
    return {
      execution: {
        mode: "agent",
        prompt,
        providerId: provider,
        model,
        reasoningLevel: options.reasoning ?? "medium",
        ...(serviceTier === undefined ? {} : { serviceTier }),
        permissionMode: await resolvePermissionMode(
          bb,
          provider,
          options["permission-mode"],
          providerRoutingForEnvironment(environment),
        ),
        environment,
        ...(options["target-thread"]
          ? { targetThreadId: options["target-thread"] }
          : {}),
      },
    };
  }
  if (
    options.provider !== undefined ||
    options.model !== undefined ||
    options.reasoning !== undefined ||
    options["service-tier"] !== undefined ||
    options["clear-service-tier"] === true ||
    options["permission-mode"] !== undefined ||
    options["target-thread"] !== undefined ||
    options.environment !== undefined ||
    options["new-environment"] !== undefined ||
    options["base-branch"] !== undefined
  ) {
    throw cliError(
      "Автоматизации скрипта не принимают параметры выполнения агента.",
      "unexpected_argument",
    );
  }
  if (script !== undefined && scriptFile !== undefined) {
    throw cliError(
      "Укажите ровно один параметр: --script или --script-file.",
      "unexpected_argument",
    );
  }
  const timeoutMs = options.timeout;
  const env = parseScriptEnv(options["env-json"]);
  const workingDirectoryOption = options["working-directory"];
  const workingDirectory =
    workingDirectoryOption === undefined
      ? undefined
      : parseScriptWorkingDirectory(workingDirectoryOption);
  const scriptSource = await loadScriptFileSource(bb, options, ctx);
  const content = scriptSource ? scriptSource.content : script;
  if (!content) throw cliError("Содержимое скрипта отсутствует.", "invalid_value");
  const interpreter =
    options.interpreter ??
    (scriptSource ? interpreterForPath(scriptSource.path) : undefined);
  return {
    execution: {
      mode: "script",
      script: content,
      ...(scriptSource ? { scriptFile: scriptSource.fileName } : {}),
      ...(interpreter ? { interpreter } : {}),
      ...(workingDirectory ? { workingDirectory } : {}),
      timeoutMs: timeoutMs ?? AUTOMATION_SCRIPT_TIMEOUT_DEFAULT_MS,
      ...(env ? { env } : {}),
    },
    ...(scriptSource ? { scriptSource } : {}),
  };
}

const SCRIPT_UPDATE_OPTION_NAMES = [
  "script",
  "script-file",
  "host",
  "interpreter",
  "timeout",
  "env-json",
  "working-directory",
] as const;

function hasAgentOptions(options: AgentOptionValues): boolean {
  return [
    options.prompt,
    options.provider,
    options.model,
    options.reasoning,
    options["service-tier"],
    options["clear-service-tier"] || undefined,
    options["permission-mode"],
    options["target-thread"],
    options.environment,
    options["new-environment"],
    options["base-branch"],
  ].some((value) => value !== undefined);
}

async function buildScriptExecutionUpdate(
  bb: Pick<BbPluginApi, "sdk">,
  options: ScriptOptionValues,
  ctx: Pick<PluginCliContext, "cwd" | "threadId">,
): Promise<{ update: ScriptExecutionUpdate; scriptSource?: ScriptFileSource }> {
  if (options.script !== undefined && options["script-file"] !== undefined) {
    throw cliError(
      "Укажите ровно один параметр: --script или --script-file.",
      "unexpected_argument",
    );
  }
  const env = parseScriptEnv(options["env-json"]);
  const workingDirectoryOption = options["working-directory"];
  const scriptSource = await loadScriptFileSource(bb, options, ctx);
  const update: ScriptExecutionUpdate = {};
  if (scriptSource !== undefined) {
    update.script = scriptSource.content;
    update.scriptFile = scriptSource.fileName;
  } else if (options.script !== undefined) {
    update.script = options.script;
  }
  if (update.script === "") {
    throw cliError("Содержимое скрипта отсутствует.", "invalid_value");
  }
  if (options.interpreter !== undefined) {
    update.interpreter = options.interpreter;
  }
  if (options.timeout !== undefined) update.timeoutMs = options.timeout;
  if (env !== undefined) update.env = env;
  if (workingDirectoryOption !== undefined) {
    update.workingDirectory = parseScriptWorkingDirectory(
      workingDirectoryOption,
    );
  }
  return { update, ...(scriptSource ? { scriptSource } : {}) };
}

async function buildAgentExecutionUpdate(
  bb: Pick<BbPluginApi, "sdk">,
  options: AgentOptionValues,
  ctx: Pick<PluginCliContext, "threadId">,
): Promise<AgentExecutionUpdate | undefined> {
  if (!hasAgentOptions(options)) return undefined;

  validateAgentTargetOptions(options);
  const update: AgentExecutionUpdate = {};
  if (options.prompt !== undefined) {
    update.prompt = requireOptionValue("prompt", options.prompt);
  }
  if (options.provider !== undefined) {
    update.providerId = requireOptionValue("provider", options.provider);
  }
  if (options.model !== undefined) {
    update.model = requireOptionValue("model", options.model);
  }
  if (options.reasoning !== undefined) {
    update.reasoningLevel = options.reasoning;
  }
  const serviceTier = options["service-tier"];
  if (options["clear-service-tier"]) {
    update.serviceTier = null;
  } else if (serviceTier !== undefined) {
    update.serviceTier = serviceTier;
  }
  if (options["permission-mode"] !== undefined) {
    update.permissionMode = options["permission-mode"];
  }
  if (options["target-thread"] !== undefined) {
    update.target = {
      type: "target-thread",
      threadId: requireOptionValue("target-thread", options["target-thread"]),
    };
  } else if (
    options.environment !== undefined ||
    options["new-environment"] !== undefined
  ) {
    update.target = {
      type: "environment",
      environment: await buildAgentEnvironment(bb, options, ctx),
    };
  }
  return update;
}

async function buildUpdateRequest(
  bb: Pick<BbPluginApi, "sdk">,
  service: Pick<AutomationService, "get">,
  options: UpdateOptionValues,
  automationId: string,
  ctx: Pick<PluginCliContext, "cwd" | "projectId" | "threadId">,
): Promise<{
  request: UpdateAutomationInput;
  scriptSource?: ScriptFileSource;
}> {
  const projectId = requireProjectId(options.project, ctx);
  const request: UpdateAutomationInput = { projectId, automationId };
  if (options.name !== undefined) request.name = options.name;
  if (
    options.cron !== undefined ||
    options.timezone !== undefined ||
    options.at !== undefined ||
    options.in !== undefined
  ) {
    request.trigger = buildTrigger(options);
  }
  let scriptSource: ScriptFileSource | undefined;
  const replacesAgentExecution =
    options.prompt !== undefined &&
    options.provider !== undefined &&
    options.model !== undefined;
  const hasScriptOptions = SCRIPT_UPDATE_OPTION_NAMES.some(
    (name) => options[name] !== undefined,
  );
  if (replacesAgentExecution) {
    const built = await buildExecution(bb, options, ctx);
    request.execution = built.execution;
  } else if (hasScriptOptions) {
    if (hasAgentOptions(options)) {
      throw cliError(
        "Нельзя одновременно указывать параметры агента и скрипта.",
        "unexpected_argument",
      );
    }
    const current = await service.get({ projectId, automationId });
    if ("execution" in current && current.execution.mode === "agent") {
      const built = await buildExecution(bb, options, ctx);
      request.execution = built.execution;
      scriptSource = built.scriptSource;
    } else {
      const built = await buildScriptExecutionUpdate(bb, options, ctx);
      request.script = built.update;
      scriptSource = built.scriptSource;
    }
  } else {
    const agentUpdate = await buildAgentExecutionUpdate(bb, options, ctx);
    if (agentUpdate !== undefined) {
      request.agent = agentUpdate;
    }
  }
  if (
    request.name === undefined &&
    request.trigger === undefined &&
    request.execution === undefined &&
    request.agent === undefined &&
    request.script === undefined
  ) {
    throw cliError(
      "Изменения не указаны. Передайте --name, параметры расписания, полный набор параметров агента или скрипта либо параметры частичного обновления.",
      "missing_required",
    );
  }
  return { request, ...(scriptSource ? { scriptSource } : {}) };
}

function formatTimestamp(value: number | null): string {
  return value === null ? "-" : new Date(value).toLocaleString("ru-RU");
}

function formatAutomationTrigger(automation: AutomationResponse): string {
  if (automation.trigger.triggerType === "once") {
    return `однократно в ${formatTimestamp(automation.trigger.runAt)}`;
  }
  return `${automation.trigger.cron} (${automation.trigger.timezone})`;
}

type PrintableAutomation =
  | AutomationDetailResponse
  | Extract<AutomationReadProblem, { problem: "missing-agent-prompt" }>;

function printAutomation(
  automation: PrintableAutomation,
  status?: string,
): string {
  const lines = [
    "",
    `  ID:        ${automation.id}`,
    `  Название:  ${automation.name}`,
    ...(status === undefined ? [] : [`  Статус:   ${status}`]),
    `  Включено:  ${automation.enabled ? "да" : "нет"}`,
    `  Режим:     ${automation.execution.mode}`,
    `  Расписание: ${formatAutomationTrigger(automation)}`,
    `  Следующий запуск: ${formatTimestamp(automation.nextRunAt)}`,
    `  Последний запуск: ${formatTimestamp(automation.lastRunAt)}`,
    `  Запусков:  ${automation.runCount}`,
    `  Источник:  ${automation.origin}`,
  ];
  if (
    automation.execution.mode === "script" &&
    automation.execution.storedScriptPath !== undefined
  ) {
    lines.push(`  Скрипт:    ${automation.execution.storedScriptPath}`);
  }
  if (automation.execution.mode === "script") {
    lines.push(
      `  Рабочая папка: ${automation.execution.resolvedWorkingDirectory ?? "недоступна"}`,
    );
  }
  if (automation.execution.mode === "agent") {
    lines.push(
      `  Провайдер: ${automation.execution.providerId}`,
      `  Модель:    ${automation.execution.model}`,
      `  Рассуждения: ${automation.execution.reasoningLevel}`,
      `  Уровень сервиса: ${automation.execution.serviceTier ?? "-"}`,
      `  Разрешения: ${automation.execution.permissionMode}`,
    );
  }
  if (automation.lastError) lines.push(`  Ошибка:    ${automation.lastError}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function shellQuote(value: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/u.test(value)
    ? value
    : `'${value.replaceAll("'", "'\\''")}'`;
}

function refreshScriptFileCommand(
  automation: AutomationDetailResponse,
  source: ScriptFileSource,
): string {
  const argv = [
    "bb",
    "automation",
    "update",
    automation.id,
    "--project",
    automation.projectId,
    "--script-file",
    source.path,
  ];
  if (source.hostId !== undefined) argv.push("--host", source.hostId);
  return argv.map(shellQuote).join(" ");
}

function printScriptFileSnapshotNote(
  automation: AutomationDetailResponse,
  source: ScriptFileSource | undefined,
): string {
  if (
    source === undefined ||
    automation.execution.mode !== "script" ||
    automation.execution.storedScriptPath === undefined
  ) {
    return "";
  }
  return [
    `Скопировано из ${source.path}${source.hostId !== undefined ? ` (хост ${source.hostId})` : ""}`,
    `    в ${automation.execution.storedScriptPath}`,
    "Автоматизация запускает эту сохранённую копию исходного файла.",
    "Изменения исходного файла применятся после выполнения команды:",
    `  ${refreshScriptFileCommand(automation, source)}`,
    "",
  ].join("\n");
}

function table(head: string[], rows: string[][]): string {
  const widths = head.map((label, index) =>
    Math.max(label.length, ...rows.map((row) => row[index]?.length ?? 0)),
  );
  const format = (row: string[]) =>
    row
      .map((cell, index) => cell.padEnd(widths[index] ?? 0))
      .join("  ")
      .trimEnd();
  return ["", format(head), ...rows.map(format), ""].join("\n") + "\n";
}

function printAutomationProblem(automation: AutomationReadProblem): string {
  if (automation.problem === "missing-agent-prompt") {
    return printAutomation(automation, "Нужен запрос");
  }
  return (
    [
      "",
      `  ID:        ${automation.id}`,
      `  Название:  ${automation.name}`,
      "  Статус:   Некорректные данные",
      "",
    ].join("\n") + "\n"
  );
}

function printAutomationTable(automations: AutomationReadResult[]): string {
  return table(
    ["ID", "Название", "Статус", "Вкл.", "Расписание", "Следующий запуск", "Запуски", "Источник"],
    automations.map((automation) =>
      "problem" in automation
        ? automation.problem === "missing-agent-prompt"
          ? [
              automation.id,
              automation.name,
              "Нужен запрос",
              automation.enabled ? "да" : "нет",
              formatAutomationTrigger(automation),
              formatTimestamp(automation.nextRunAt),
              String(automation.runCount),
              automation.origin,
            ]
          : [
              automation.id,
              automation.name,
              "Некорректные данные",
              "-",
              "-",
              "-",
              "-",
              "-",
            ]
        : [
            automation.id,
            automation.name,
            "-",
            automation.enabled ? "да" : "нет",
            formatAutomationTrigger(automation),
            formatTimestamp(automation.nextRunAt),
            String(automation.runCount),
            automation.origin,
          ],
    ),
  );
}

function printRunTable(runs: AutomationRunResponse[]): string {
  return table(
    ["ID", "Статус", "Начало", "Чат/код выхода", "Подробности"],
    runs.map((run) => [
      run.id,
      run.status,
      formatTimestamp(run.startedAt),
      run.threadId ?? (run.exitCode === null ? "-" : `код выхода ${run.exitCode}`),
      run.skipReason ?? run.error ?? "-",
    ]),
  );
}

export function registerAutomationCli(args: {
  bb: Pick<BbPluginApi, "cli" | "sdk">;
  service: AutomationService;
}): void {
  const { bb, service } = args;
  bb.cli.register(
    defineCli({
      name: "automation",
      summary: "Просмотр и управление автоматизациями (запуски агентов и скриптов по расписанию)",
      description: DESCRIPTION,
      root: cliCommand({
        summary: "Показать команды автоматизаций",
        run: (input) => ({ exitCode: 0, stdout: input.help }),
      }),
      commands: {
        list: cliCommand({
          summary: "Список автоматизаций проекта или целевого чата",
          options: {
            project: {
              type: "string",
              placeholder: "id",
              description:
                "Проект для вывода автоматизаций; обязателен без --target-thread",
            },
            "target-thread": {
              type: "string",
              placeholder: "thread-id",
              description:
                "Показать автоматизации любого проекта, отправляющие запросы в этот чат",
            },
            json: JSON_OPTION,
          },
          constraints: [
            { kind: "at-most-one", options: ["project", "target-thread"] },
          ],
          run: (input, ctx) =>
            attempt(async () => {
              const targetThreadId = input.options["target-thread"];
              const result = service.list(
                targetThreadId === undefined
                  ? {
                      projectId: requireProjectId(input.options.project, ctx),
                    }
                  : {
                      targetThreadId: requireOptionValue(
                        "target-thread",
                        targetThreadId,
                      ),
                    },
              );
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? jsonOutput(result)
                  : result.length === 0
                    ? "Автоматизации не найдены\n"
                    : printAutomationTable(result),
              };
            }),
        }),
        create: cliCommand({
          summary: "Создать автоматизацию",
          description:
            "Выберите ровно один параметр расписания и один режим выполнения: агент (--prompt --provider --model) или скрипт (--script либо --script-file).",
          options: {
            project: PROJECT_OPTION,
            name: {
              type: "string",
              placeholder: "name",
              required: true,
              description: "Отображаемое название, до 200 символов",
            },
            disabled: {
              type: "boolean",
              description: "Создать приостановленную автоматизацию",
            },
            ...SCHEDULE_OPTIONS,
            ...AGENT_OPTIONS,
            ...SCRIPT_OPTIONS,
            json: JSON_OPTION,
          },
          constraints: [
            { kind: "exactly-one", options: ["cron", "at", "in"] },
            { kind: "requires", option: "cron", needs: ["timezone"] },
            { kind: "requires", option: "timezone", needs: ["cron"] },
          ],
          run: (input, ctx) =>
            attempt(async () => {
              const projectId = requireProjectId(input.options.project, ctx);
              const { execution, scriptSource } = await buildExecution(
                bb,
                input.options,
                ctx,
              );
              const request: ResolvedCreateAutomationInput = {
                projectId,
                name: input.options.name,
                enabled: !input.options.disabled,
                trigger: buildTrigger(input.options),
                execution,
                origin: ctx.threadId ? "agent" : "human",
                ...(ctx.threadId ? { createdByThreadId: ctx.threadId } : {}),
              };
              const created = await service.create(request);
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? jsonOutput(created)
                  : `Автоматизация создана: ${created.id}\n${printAutomation(created)}${printScriptFileSnapshotNote(created, scriptSource)}`,
              };
            }),
        }),
        show: cliCommand({
          summary: "Показать сведения об автоматизации",
          positionals: [AUTOMATION_ID_POSITIONAL],
          options: { project: PROJECT_OPTION, json: JSON_OPTION },
          run: (input, ctx) =>
            attempt(async () => {
              const found = await service.get({
                projectId: requireProjectId(input.options.project, ctx),
                automationId: input.positionals.automationId,
              });
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? jsonOutput(found)
                  : "problem" in found
                    ? printAutomationProblem(found)
                    : printAutomation(found),
              };
            }),
        }),
        update: cliCommand({
          summary: "Изменить настройки автоматизации",
          description:
            "Измените существующего агента или скрипт любым набором параметров; пропущенные настройки сохраняются. --prompt --provider --model вместе заменяют выполнение новым агентом, а параметры скрипта заменяют агента скриптом (требуется --script или --script-file).",
          positionals: [AUTOMATION_ID_POSITIONAL],
          options: {
            project: PROJECT_OPTION,
            name: {
              type: "string",
              placeholder: "name",
              description: "Новое отображаемое название, до 200 символов",
            },
            ...SCHEDULE_OPTIONS,
            ...AGENT_OPTIONS,
            ...SCRIPT_OPTIONS,
            json: JSON_OPTION,
          },
          constraints: [
            { kind: "at-most-one", options: ["cron", "at", "in"] },
            { kind: "requires", option: "cron", needs: ["timezone"] },
            { kind: "requires", option: "timezone", needs: ["cron"] },
          ],
          run: (input, ctx) =>
            attempt(async () => {
              const { request, scriptSource } = await buildUpdateRequest(
                bb,
                service,
                input.options,
                input.positionals.automationId,
                ctx,
              );
              const updated = await service.update(request);
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? jsonOutput(updated)
                  : `Автоматизация ${updated.id} обновлена\n${printAutomation(updated)}${printScriptFileSnapshotNote(updated, scriptSource)}`,
              };
            }),
        }),
        pause: cliCommand({
          summary: "Приостановить автоматизацию",
          positionals: [AUTOMATION_ID_POSITIONAL],
          options: { project: PROJECT_OPTION, json: JSON_OPTION },
          run: (input, ctx) =>
            attempt(async () => {
              const updated = service.pause({
                projectId: requireProjectId(input.options.project, ctx),
                automationId: input.positionals.automationId,
              });
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? jsonOutput(updated)
                  : `Автоматизация ${updated.id} приостановлена\n`,
              };
            }),
        }),
        resume: cliCommand({
          summary: "Возобновить автоматизацию",
          positionals: [AUTOMATION_ID_POSITIONAL],
          options: { project: PROJECT_OPTION, json: JSON_OPTION },
          run: (input, ctx) =>
            attempt(async () => {
              const updated = service.resume({
                projectId: requireProjectId(input.options.project, ctx),
                automationId: input.positionals.automationId,
              });
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? jsonOutput(updated)
                  : `Автоматизация ${updated.id} возобновлена\n`,
              };
            }),
        }),
        run: cliCommand({
          summary: "Запустить автоматизацию сейчас",
          positionals: [AUTOMATION_ID_POSITIONAL],
          options: {
            project: PROJECT_OPTION,
            "idempotency-key": {
              type: "string",
              placeholder: "key",
              description:
                "Повторно использовать запуск с этим ключом из предыдущего вызова, до 200 символов",
            },
            json: JSON_OPTION,
          },
          run: (input, ctx) =>
            attempt(async () => {
              const idempotencyKey = input.options["idempotency-key"];
              const result = await service.run({
                projectId: requireProjectId(input.options.project, ctx),
                automationId: input.positionals.automationId,
                ...(idempotencyKey ? { idempotencyKey } : {}),
              });
              const threadLine = result.run.threadId
                ? `Чат: ${result.run.threadId}\n`
                : "";
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? jsonOutput(result)
                  : `Запуск начат: ${result.run.id}\n${threadLine}`,
              };
            }),
        }),
        runs: cliCommand({
          summary: "Показать запуски автоматизации",
          positionals: [AUTOMATION_ID_POSITIONAL],
          options: {
            project: PROJECT_OPTION,
            limit: {
              type: "integer",
              min: 1,
              max: AUTOMATION_RUNS_LIMIT_MAX,
              default: AUTOMATION_RUNS_LIMIT_DEFAULT,
              description: "Сколько последних запусков показать",
            },
            output: {
              type: "string",
              placeholder: "runId",
              description:
                "Вывести только сохранённый вывод этого запуска; он должен входить в --limit",
            },
            json: JSON_OPTION,
          },
          run: (input, ctx) =>
            attempt(async () => {
              const result = service.runs({
                projectId: requireProjectId(input.options.project, ctx),
                automationId: input.positionals.automationId,
                limit: input.options.limit,
              });
              const outputRunId = input.options.output;
              if (outputRunId) {
                const run = result.runs.find(
                  (candidate) => candidate.id === outputRunId,
                );
                if (!run) {
                  throw cliError(
                    `Запуск ${outputRunId} не найден среди результатов. Если он старше, увеличьте --limit.`,
                    "not_found",
                  );
                }
                return {
                  exitCode: 0,
                  stdout: input.options.json
                    ? jsonOutput(run)
                    : `${run.output ?? ""}\n`,
                };
              }
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? jsonOutput(result)
                  : result.runs.length === 0
                    ? "Запуски не найдены\n"
                    : printRunTable(result.runs),
              };
            }),
        }),
        delete: cliCommand({
          summary: "Удалить автоматизацию",
          positionals: [AUTOMATION_ID_POSITIONAL],
          options: {
            project: PROJECT_OPTION,
            yes: {
              type: "boolean",
              description: "Обязательно. Подтверждает удаление автоматизации",
            },
            json: JSON_OPTION,
          },
          run: (input, ctx) =>
            attempt(async () => {
              if (!input.options.yes) {
                throw cliError(
                  "Для удаления через CLI плагина требуется --yes.",
                  "missing_required",
                );
              }
              const projectId = requireProjectId(input.options.project, ctx);
              const automationId = input.positionals.automationId;
              await service.delete({ projectId, automationId });
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? jsonOutput({ ok: true, id: automationId })
                  : `Автоматизация ${automationId} удалена\n`,
              };
            }),
        }),
      },
    }),
  );
}
