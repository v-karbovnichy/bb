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

import {
  createComment,
  invalidateFolders,
  invalidateProjectTasks,
  registerHandlers,
  type TasksApiStore,
} from "../api";
import {
  invalidateAttachmentChanged,
  readAttachmentContent,
  saveAttachmentFromBytes,
} from "../attachments";
import { delegationRpcContract } from "../delegate/contract";
import { handlers as delegationHandlers } from "../delegate";
import {
  presetReasoningLevelSchema,
  tasksRpcContract,
  PRESET_PERMISSION_MODES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  ULID_PATTERN,
  type Attachment,
  type Folder,
  type Label,
  type Project,
  type Preset,
  type Task,
  type TaskMutationResult,
} from "../shared/contract";
import { attachmentDownloadUrl } from "../shared/attachments";
import { errorMessage } from "../shared/errors";
import {
  TASK_SORTS,
  TASKS_PAGE_DEFAULT_LIMIT,
  TASKS_PAGE_MAX_LIMIT,
} from "../shared/pagination";
import { bytes, detail, oneLine, table } from "./format";
import { allocatePrefix } from "./prefix";
import { seedDemo } from "./seed";

const TASK_KEY_PATTERN = /^([A-Z][A-Z0-9]{0,9})-(\d+)$/;
const BB_PROJECT_ID_PATTERN = /^proj_[A-Za-z0-9_-]+$/;
const ACTIVE_THREAD_STATUSES = new Set(["starting", "working"]);
const DEFAULT_PROJECT_COLOR = "blue";
const DEFAULT_LABEL_COLOR = "gray";

const PRESET_ENVIRONMENTS = ["project-default", "worktree"] as const;

const JSON_OPTION = {
  type: "boolean",
  description: "Вывести машиночитаемый JSON",
} as const;

const MACHINE_OPTION = {
  type: "string",
  placeholder: "id-or-name",
  description:
    "Зарегистрированная машина, на которой находятся файлы; по умолчанию машина вызвавшего чата, иначе сервер",
} as const;

const PROJECT_OPTION = {
  type: "string",
  placeholder: "prefix-or-id",
  description:
    "Префикс или идентификатор проекта задач, например ABC; не идентификатор проекта bb (proj_...). Используйте bb tasks project list",
} as const;

const REQUIRED_PROJECT_OPTION = {
  ...PROJECT_OPTION,
  description: `${PROJECT_OPTION.description} (required)`,
} as const;

const KEY_POSITIONAL = {
  name: "key-or-id",
  description: "Ключ задачи, например ABC-12 (без учёта регистра), или её ULID",
  required: true,
} as const;

interface PluginStatus {
  name: string;
  version: string;
}

type TasksDomain = ReturnType<typeof registerHandlers>;
type ListTasksInput = Parameters<TasksDomain["listTasks"]>[0];

class CliError extends PluginCliError {
  constructor(
    message: string,
    options?: { code?: string; hint?: string; exitCode?: number },
  ) {
    super(oneLine(message), options);
  }
}

function friendlyError(error: unknown): string {
  if (error instanceof PluginCliError) return error.message;
  if (error instanceof z.ZodError) {
    const issue = error.issues[0];
    const path = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return `${path}${issue?.message ?? "некорректный ввод"}`;
  }
  const message = errorMessage(error);
  if (message.includes("UNIQUE constraint failed: projects.prefix")) {
    return "префикс проекта уже используется";
  }
  if (
    message.includes("UNIQUE constraint failed: labels.project_id, labels.name")
  ) {
    return "название метки уже используется в этом проекте";
  }
  return message;
}

async function guard(
  action: () => Promise<string | PluginCliResult>,
): Promise<PluginCliResult> {
  try {
    const result = await action();
    return typeof result === "string"
      ? { exitCode: 0, stdout: result }
      : result;
  } catch (error) {
    if (error instanceof PluginCliError) throw error;
    throw new CliError(friendlyError(error));
  }
}

function normalizePrefix(value: string): string {
  return value.trim().toUpperCase();
}

function unwrapTask(result: TaskMutationResult): Task {
  if (!result.ok) throw new CliError(result.error.message);
  return result.task;
}

async function resolveClientHostId(
  bb: BbPluginApi,
  domain: TasksDomain,
  machine: string | undefined,
  ctx: PluginCliContext,
): Promise<string | undefined> {
  if (machine !== undefined) return resolveMachineId(domain, machine);
  if (!ctx.threadId) return undefined;
  const thread = await bb.sdk.threads.get({ threadId: ctx.threadId });
  if (!thread.environmentId) return undefined;
  const environment = await bb.sdk.environments.get({
    environmentId: thread.environmentId,
  });
  return environment.hostId;
}

function isMissingClientFileError(error: unknown): boolean {
  const message = errorMessage(error);
  return /\bENOENT\b|does not exist|not found|is a directory/i.test(message);
}

async function readClientFile(
  bb: BbPluginApi,
  hostId: string | undefined,
  path: string,
): Promise<{ bytes: Buffer; text: string | null }> {
  const file = await bb.sdk.files.read({
    ...(hostId ? { hostId } : {}),
    path,
  });
  return {
    bytes: Buffer.from(
      file.content,
      file.contentEncoding === "base64" ? "base64" : "utf8",
    ),
    text: file.contentEncoding === "utf8" ? file.content : null,
  };
}

async function readAttachmentSource(
  bb: BbPluginApi,
  hostId: string | undefined,
  path: string,
): Promise<Buffer> {
  try {
    return (await readClientFile(bb, hostId, path)).bytes;
  } catch (error) {
    if (isMissingClientFileError(error)) {
      throw new CliError(`источник вложения не является файлом: ${path}`, {
        code: "attachment_source_missing",
      });
    }
    throw error;
  }
}

async function writeClientFile(
  bb: BbPluginApi,
  hostId: string | undefined,
  path: string,
  content: Buffer,
): Promise<void> {
  await bb.sdk.files.write({
    ...(hostId ? { hostId } : {}),
    path,
    content: content.toString("base64"),
    contentEncoding: "base64",
    createParents: true,
  });
}

function resolveClientPath(rootPath: string, path: string): string {
  const resolved = resolveHostPath({ rootPath, path });
  if (resolved === null) throw new CliError(`Некорректный путь хоста: ${path}`);
  return resolved;
}

function attachmentFileName(path: string): string {
  return getHostPathBasename(path) || "attachment";
}

async function readTextOption(
  bb: BbPluginApi,
  ctx: PluginCliContext,
  hostId: string | undefined,
  inline: string | undefined,
  file: string | undefined,
): Promise<string | undefined> {
  if (file === undefined) return inline;
  const path = resolveClientPath(ctx.cwd ?? process.cwd(), file);
  try {
    const { text } = await readClientFile(bb, hostId, path);
    if (text === null) {
      throw new CliError(`не удалось прочитать ${file}: файл не содержит текст UTF-8`);
    }
    return text;
  } catch (error) {
    if (error instanceof PluginCliError) throw error;
    throw new CliError(`не удалось прочитать ${file}: ${errorMessage(error)}`);
  }
}

function derivePrefix(name: string, projects: readonly Project[]): string {
  let base = name.toUpperCase().replace(/[^A-Z0-9]/gu, "");
  if (!base || !/^[A-Z]/u.test(base)) base = `P${base}`;
  base = base.slice(0, 10);
  const prefix = allocatePrefix(
    base,
    new Set(projects.map((project) => project.prefix)),
  );
  if (prefix === null) {
    throw new CliError(`не удалось получить уникальный префикс из ${name}`);
  }
  return prefix;
}

async function listProjects(domain: TasksDomain): Promise<Project[]> {
  return tasksRpcContract.listProjects.output.parse(
    await domain.listProjects(tasksRpcContract.listProjects.input.parse({})),
  ).projects;
}

function bbProjectIdHint(
  address: string,
  projects: readonly Project[],
): string {
  const linked = projects.filter(
    (project) => project.linkedBbProjectId === address,
  );
  const first = linked[0];
  if (linked.length === 1 && first) {
    return `${address} is a bb project id; its tracker project is ${first.prefix} — re-run with --project ${first.prefix}`;
  }
  return `${address} is a bb project id, but --project takes a tracker project prefix or id; run bb tasks project list`;
}

async function resolveProject(
  domain: TasksDomain,
  address: string,
): Promise<Project> {
  const normalized = address.trim().toUpperCase();
  const projects = await listProjects(domain);
  const project = projects.find(
    (candidate) =>
      candidate.id === normalized || candidate.prefix === normalized,
  );
  if (!project) {
    const trimmed = address.trim();
    throw new CliError(`проект не найден: ${address}`, {
      code: "project_not_found",
      ...(BB_PROJECT_ID_PATTERN.test(trimmed)
        ? { hint: bbProjectIdHint(trimmed, projects) }
        : {}),
    });
  }
  return project;
}

async function defaultProject(
  domain: TasksDomain,
  ctx: PluginCliContext,
  required: boolean,
): Promise<Project | undefined> {
  if (!ctx.projectId) {
    if (required) {
      throw new CliError(
        "Не указан --project и нет контекста проекта BB",
        { code: "missing_required" },
      );
    }
    return undefined;
  }
  const matches = (await listProjects(domain)).filter(
    (project) => project.linkedBbProjectId === ctx.projectId,
  );
  if (matches.length === 0) {
    throw new CliError(
      `С проектом BB ${ctx.projectId} не связан ни один проект задач; укажите --project или создайте связь через bb tasks project update`,
      { code: "project_not_linked" },
    );
  }
  if (matches.length > 1) {
    throw new CliError(
      `С проектом BB ${ctx.projectId} связаны несколько проектов задач; укажите --project явно`,
      { code: "project_ambiguous" },
    );
  }
  return matches[0];
}

async function selectedProject(
  domain: TasksDomain,
  ctx: PluginCliContext,
  address: string | undefined,
  required: boolean,
): Promise<Project | undefined> {
  return address
    ? resolveProject(domain, address)
    : defaultProject(domain, ctx, required);
}

async function requiredProject(
  domain: TasksDomain,
  ctx: PluginCliContext,
  address: string | undefined,
): Promise<Project> {
  if (address) return resolveProject(domain, address);
  const linked = ctx.projectId
    ? (await listProjects(domain)).filter(
        (project) => project.linkedBbProjectId === ctx.projectId,
      )
    : [];
  const suggestion = linked.length === 1 ? linked[0] : undefined;
  throw new CliError("отсутствует обязательный параметр --project", {
    code: "missing_required",
    hint: suggestion
      ? `Проект bb этого чата ${ctx.projectId} связан с проектом задач ${suggestion.prefix}; повторите команду с --project ${suggestion.prefix}`
      : "Укажите префикс или идентификатор проекта задач; список доступен через bb tasks project list",
  });
}

async function resolveFolder(
  domain: TasksDomain,
  address: string,
): Promise<Folder> {
  const folders = tasksRpcContract.listFolders.output.parse(
    await domain.listFolders(tasksRpcContract.listFolders.input.parse(null)),
  ).folders;
  const normalizedId = address.trim().toUpperCase();
  const byId = folders.find((folder) => folder.id === normalizedId);
  if (byId) return byId;
  const byName = folders.filter(
    (folder) => folder.name.toLowerCase() === address.trim().toLowerCase(),
  );
  if (byName.length === 0) {
    throw new CliError(`папка не найдена: ${address}`, {
      code: "folder_not_found",
    });
  }
  if (byName.length > 1) {
    throw new CliError(`название папки неоднозначно; укажите её идентификатор: ${address}`, {
      code: "folder_ambiguous",
    });
  }
  return byName[0]!;
}

async function resolveTask(
  domain: TasksDomain,
  address: string,
): Promise<Task> {
  const normalized = address.trim().toUpperCase();
  if (ULID_PATTERN.test(normalized)) {
    const result = tasksRpcContract.getTask.output.parse(
      await domain.getTask(
        tasksRpcContract.getTask.input.parse({ taskId: normalized }),
      ),
    );
    if (!result.task) throw taskNotFound(address);
    return result.task;
  }
  if (!TASK_KEY_PATTERN.test(normalized)) throw taskNotFound(address);
  const result = tasksRpcContract.getTaskByKey.output.parse(
    await domain.getTaskByKey(
      tasksRpcContract.getTaskByKey.input.parse({ taskKey: normalized }),
    ),
  );
  if (!result.task) throw taskNotFound(address);
  return result.task;
}

function taskNotFound(address: string): CliError {
  return new CliError(`задача не найдена: ${address}`, { code: "task_not_found" });
}

async function listAllTasks(
  domain: TasksDomain,
  input: ListTasksInput,
): Promise<Task[]> {
  const tasks: Task[] = [];
  let cursor = input.cursor;
  do {
    const page = tasksRpcContract.listTasks.output.parse(
      await domain.listTasks(
        tasksRpcContract.listTasks.input.parse({
          ...input,
          limit: TASKS_PAGE_MAX_LIMIT,
          ...(cursor === undefined ? {} : { cursor }),
        }),
      ),
    );
    tasks.push(...page.tasks);
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined);
  return tasks;
}

function resolvePreset(presets: readonly Preset[], address: string): Preset {
  const normalized = address.trim().toLowerCase();
  const matches = presets.filter(
    (preset) =>
      preset.id.toLowerCase() === normalized ||
      preset.name.toLowerCase() === normalized,
  );
  if (matches.length === 0) {
    throw new CliError(`пресет не найден: ${address}`, {
      code: "preset_not_found",
    });
  }
  if (matches.length > 1) {
    throw new CliError(`название пресета неоднозначно; укажите его идентификатор: ${address}`, {
      code: "preset_ambiguous",
    });
  }
  return matches[0]!;
}

async function listTaskAttachments(
  domain: TasksDomain,
  taskId: string,
  comments: readonly { id: string }[],
): Promise<Attachment[]> {
  const attachments = [
    ...tasksRpcContract.listAttachments.output.parse(
      await domain.listAttachments(
        tasksRpcContract.listAttachments.input.parse({ taskId }),
      ),
    ).attachments,
  ];
  for (const comment of comments) {
    attachments.push(
      ...tasksRpcContract.listAttachments.output.parse(
        await domain.listAttachments(
          tasksRpcContract.listAttachments.input.parse({
            commentId: comment.id,
          }),
        ),
      ).attachments,
    );
  }
  return attachments;
}

async function listPresets(domain: TasksDomain): Promise<Preset[]> {
  return tasksRpcContract.listPresets.output.parse(
    await domain.listPresets(tasksRpcContract.listPresets.input.parse(null)),
  ).presets;
}

function presetEnvironmentLabel(preset: Preset): string {
  return preset.environmentKind === "new-worktree"
    ? "worktree"
    : "project-default";
}

function presetEnvironmentKind(
  value: (typeof PRESET_ENVIRONMENTS)[number] | undefined,
  fallback: Preset["environmentKind"],
): Preset["environmentKind"] {
  if (value === undefined) return fallback;
  return value === "worktree" ? "new-worktree" : "project-default";
}

function presetServiceTier(
  value: string | undefined,
  clear: boolean | undefined,
): string | null | undefined {
  if (clear && value !== undefined) {
    throw new CliError(
      "Нельзя одновременно указать --service-tier и --clear-service-tier.",
    );
  }
  return clear ? null : value;
}

async function resolveMachineId(
  domain: TasksDomain,
  address: string,
): Promise<string> {
  const machines = tasksRpcContract.listMachines.output.parse(
    await domain.listMachines(tasksRpcContract.listMachines.input.parse({})),
  ).machines;
  const normalized = address.trim().toLocaleLowerCase();
  const matches = machines.filter(
    (machine) =>
      machine.id === address.trim() ||
      machine.name.toLocaleLowerCase() === normalized,
  );
  if (matches.length === 0) {
    throw new CliError(`машина не найдена: ${address}`, {
      code: "machine_not_found",
    });
  }
  if (matches.length > 1) {
    throw new CliError(`название машины неоднозначно; укажите её идентификатор: ${address}`, {
      code: "machine_ambiguous",
    });
  }
  return matches[0]!.id;
}

function validatePresetTargetOptions(input: {
  environmentKind: Preset["environmentKind"];
  baseBranch: string | undefined;
  machine: string | undefined;
}): void {
  if (input.environmentKind === "new-worktree") return;
  if (input.baseBranch !== undefined) {
    throw new CliError("для --base-branch требуется --environment worktree");
  }
  if (input.machine !== undefined) {
    throw new CliError("для --machine требуется --environment worktree");
  }
}

async function projectLabels(
  domain: TasksDomain,
  projectId: string,
): Promise<Label[]> {
  return tasksRpcContract.listLabels.output.parse(
    await domain.listLabels(
      tasksRpcContract.listLabels.input.parse({ projectId }),
    ),
  ).labels;
}

function resolveLabel(labels: readonly Label[], address: string): Label {
  const normalizedId = address.trim().toUpperCase();
  const label = labels.find(
    (candidate) =>
      candidate.id === normalizedId ||
      candidate.name.toLowerCase() === address.trim().toLowerCase(),
  );
  if (!label) {
    throw new CliError(`метка не найдена: ${address}`, {
      code: "label_not_found",
    });
  }
  return label;
}

function projectTable(
  projects: readonly Project[],
  folders: readonly Folder[],
) {
  const folderNames = new Map(
    folders.map((folder) => [folder.id, folder.name]),
  );
  return table(
    ["PREFIX", "НАЗВАНИЕ", "ПАПКА", "ПРОЕКТ BB", "ID"],
    projects.map((project) => [
      project.prefix,
      project.name,
      project.folderId
        ? (folderNames.get(project.folderId) ?? project.folderId)
        : "-",
      project.linkedBbProjectId ?? "-",
      project.id,
    ]),
    "Проектов нет.",
  );
}

function taskAuthor(ctx: PluginCliContext): string {
  return ctx.threadId ? `agent (${ctx.threadId})` : "cli";
}

async function labelsForTaskList(
  domain: TasksDomain,
  projects: readonly Project[],
): Promise<Map<string, Label>> {
  const labels = new Map<string, Label>();
  for (const project of projects) {
    for (const label of await projectLabels(domain, project.id)) {
      labels.set(label.id, label);
    }
  }
  return labels;
}

function resolveInvokingThreadId(
  thread: string | undefined,
  ctx: PluginCliContext,
): string {
  const threadId = thread ?? process.env.BB_THREAD_ID ?? ctx.threadId;
  if (!threadId) {
    throw new CliError("Не указан --thread и не задан BB_THREAD_ID", {
      code: "missing_required",
    });
  }
  return threadId;
}

function groupCommand(
  group: string,
  summary: string,
  subcommands: readonly (readonly [string, string])[],
) {
  const width = Math.max(...subcommands.map(([name]) => name.length));
  return cliCommand({
    summary,
    hidden: true,
    description: [
      "Подкоманды:",
      ...subcommands.map(
        ([name, text]) => `  bb tasks ${group} ${name.padEnd(width)}  ${text}`,
      ),
    ].join("\n"),
    positionals: [
      {
        name: "subcommand",
        description: `Одно из значений: ${subcommands.map(([name]) => name).join(", ")}`,
        variadic: true,
      },
    ],
    options: { json: JSON_OPTION },
    run(input) {
      const [subcommand] = input.positionals.subcommand;
      if (subcommand === undefined) return { exitCode: 1, stdout: input.help };
      throw new CliError(`Неизвестная команда: ${group} ${subcommand}`, {
        code: "unknown_command",
        hint: `run bb tasks ${group} --help for its subcommands`,
      });
    },
  });
}

export function registerTasksCli(
  bb: BbPluginApi,
  store: TasksApiStore,
  status: PluginStatus,
): void {
  const domain = registerHandlers(bb, store);
  bb.cli.register(
    defineCli({
      name: "tasks",
      summary:
        "Создавайте проекты задач, задачи, метки и комментарии и управляйте ими",
      description:
        "Задачи указываются ключом (ABC-12) или ULID. Параметр --project принимает префикс или идентификатор проекта задач, но не идентификатор проекта bb (proj_...).",
      commands: {
        status: cliCommand({
          summary: "Показать название и версию плагина задач",
          description:
            "Только состояние плагина. Для фильтрации задач по статусу используйте bb tasks list --status <status>; для изменения статуса — bb tasks update <key-or-id> --status <status>.",
          options: { json: JSON_OPTION },
          run(input) {
            return {
              exitCode: 0,
              stdout: input.options.json
                ? JSON.stringify(status)
                : `${status.name} ${status.version}`,
            };
          },
        }),

        project: groupCommand(
          "project",
          "Создать, показать или изменить проекты задач",
          [
            ["create", "Создать проект для отслеживания задач"],
            ["list", "Показать проекты задач"],
            ["show", "Показать проект задач"],
            ["update", "Переименовать проект, изменить его цвет, папку или связь"],
          ],
        ),
        "project create": cliCommand({
          summary: "Создать проект для отслеживания задач",
          options: {
            name: {
              type: "string",
              required: true,
              description: "Понятное название проекта",
            },
            prefix: {
              type: "string",
              placeholder: "PREFIX",
              description:
                "Префикс ключа задачи: до 10 заглавных латинских букв и цифр, начинается с буквы (если не указан, берётся из --name)",
            },
            folder: {
              type: "string",
              placeholder: "id-or-name",
              description: "Папка проекта",
            },
            "link-bb-project": {
              type: "string",
              placeholder: "proj_id",
              aliases: ["bb-project", "link-project"],
              description:
                "Идентификатор проекта bb (proj_...), чьи чаты отслеживают этот проект задач",
            },
            color: {
              type: "string",
              default: DEFAULT_PROJECT_COLOR,
              description: "Название акцентного цвета",
            },
            json: JSON_OPTION,
          },
          unexpectedPositionalHint:
            "Название проекта указывается через --name <name>.",
          run(input) {
            return guard(async () => {
              const name = input.options.name;
              const projects = await listProjects(domain);
              const folderAddress = input.options.folder;
              const folder = folderAddress
                ? await resolveFolder(domain, folderAddress)
                : undefined;
              const result = tasksRpcContract.createProject.output.parse(
                await domain.createProject(
                  tasksRpcContract.createProject.input.parse({
                    name,
                    prefix: input.options.prefix
                      ? normalizePrefix(input.options.prefix)
                      : derivePrefix(name, projects),
                    color: input.options.color,
                    folderId: folder?.id ?? null,
                    linkedBbProjectId: input.options["link-bb-project"] ?? null,
                  }),
                ),
              );
              return input.options.json
                ? JSON.stringify(result)
                : `Проект создан: ${result.project.prefix}  ${result.project.name}`;
            });
          },
        }),
        "project list": cliCommand({
          summary: "Показать проекты задач",
          options: { json: JSON_OPTION },
          run(input) {
            return guard(async () => {
              const projects = await listProjects(domain);
              const folders = tasksRpcContract.listFolders.output.parse(
                await domain.listFolders(
                  tasksRpcContract.listFolders.input.parse(null),
                ),
              ).folders;
              return input.options.json
                ? JSON.stringify({ projects })
                : projectTable(projects, folders);
            });
          },
        }),
        "project show": cliCommand({
          summary: "Показать проект задач",
          positionals: [
            {
              name: "prefix-or-id",
              description: "Префикс проекта, например ABC, или его ULID",
              required: true,
            },
          ],
          options: { json: JSON_OPTION },
          run(input) {
            return guard(async () => {
              const project = await resolveProject(
                domain,
                input.positionals["prefix-or-id"],
              );
              const folder = project.folderId
                ? await resolveFolder(domain, project.folderId)
                : null;
              if (input.options.json) {
                return JSON.stringify({ project, folder });
              }
              return detail([
                ["Проект", `${project.prefix} — ${project.name}`],
                ["ID", project.id],
                ["Цвет", project.color],
                ["Папка", folder?.name ?? "-"],
                ["Проект BB", project.linkedBbProjectId ?? "-"],
                ["Следующая задача", `${project.prefix}-${project.nextTaskNumber}`],
                ["Создано", project.createdAt],
              ]);
            });
          },
        }),
        "project update": cliCommand({
          summary: "Переименовать проект, изменить цвет, папку или связь",
          positionals: [
            {
              name: "prefix-or-id",
              description: "Префикс проекта, например ABC, или его ULID",
              required: true,
            },
          ],
          options: {
            name: { type: "string", description: "Новое название проекта" },
            color: { type: "string", description: "Новое название акцентного цвета" },
            folder: {
              type: "string",
              placeholder: "id-or-name",
              description: "Папка проекта",
            },
            "no-folder": {
              type: "boolean",
              description: "Переместить проект на верхний уровень",
            },
            "link-bb-project": {
              type: "string",
              placeholder: "proj_id",
              aliases: ["bb-project", "link-project"],
              description: "Идентификатор проекта bb (proj_...) для связи",
            },
            "unlink-bb-project": {
              type: "boolean",
              description: "Удалить связь с проектом bb",
            },
            "rename-prefix": {
              type: "string",
              placeholder: "PREFIX",
              description:
                "Новый префикс ключей задач; существующие ключи будут переписаны",
            },
            json: JSON_OPTION,
          },
          constraints: [
            { kind: "at-most-one", options: ["folder", "no-folder"] },
            {
              kind: "at-most-one",
              options: ["link-bb-project", "unlink-bb-project"],
            },
          ],
          run(input) {
            return guard(async () => {
              const project = await resolveProject(
                domain,
                input.positionals["prefix-or-id"],
              );
              const folderAddress = input.options.folder;
              const folder = folderAddress
                ? await resolveFolder(domain, folderAddress)
                : undefined;
              const changes = {
                name: input.options.name,
                color: input.options.color,
                folderId: input.options["no-folder"] ? null : folder?.id,
                linkedBbProjectId: input.options["unlink-bb-project"]
                  ? null
                  : input.options["link-bb-project"],
              };
              const renamePrefix = input.options["rename-prefix"];
              if (
                renamePrefix === undefined &&
                changes.name === undefined &&
                changes.color === undefined &&
                changes.folderId === undefined &&
                changes.linkedBbProjectId === undefined
              ) {
                throw new CliError("изменения проекта не указаны", {
                  code: "no_changes",
                });
              }
              const renameInput =
                renamePrefix === undefined
                  ? undefined
                  : tasksRpcContract.renameProjectPrefix.input.parse({
                      projectId: project.id,
                      prefix: normalizePrefix(renamePrefix),
                    });
              const hasFieldChanges =
                changes.name !== undefined ||
                changes.color !== undefined ||
                changes.folderId !== undefined ||
                changes.linkedBbProjectId !== undefined;
              const updateInput = hasFieldChanges
                ? tasksRpcContract.updateProject.input.parse({
                    projectId: project.id,
                    ...changes,
                  })
                : undefined;
              if (
                renameInput &&
                store.projectPrefixExists(renameInput.prefix, project.id)
              ) {
                throw new CliError(
                  `Префикс проекта уже используется: ${renameInput.prefix}`,
                );
              }
              const updated = store.transaction(() =>
                store.tasks.updateProject(project.id, {
                  prefix: renameInput?.prefix,
                  name: updateInput?.name,
                  color: updateInput?.color,
                  folderId: updateInput?.folderId,
                  linkedBbProjectId: updateInput?.linkedBbProjectId,
                }),
              );
              invalidateProjectTasks(bb, updated.id);
              return input.options.json
                ? JSON.stringify({ project: updated })
                : `Проект обновлён: ${updated.prefix}  ${updated.name}`;
            });
          },
        }),

        folder: groupCommand(
          "folder",
          "Создать, показать, изменить или удалить папки проектов",
          [
            ["create", "Создать папку"],
            ["list", "Показать папки"],
            ["update", "Переименовать или переместить папку"],
            ["delete", "Удалить папку, сохранив её содержимое"],
          ],
        ),
        "folder create": cliCommand({
          summary: "Создать папку проекта",
          options: {
            name: {
              type: "string",
              required: true,
              description: "Название папки",
            },
            parent: {
              type: "string",
              placeholder: "id-or-name",
              description: "Идентификатор или название родительской папки",
            },
            json: JSON_OPTION,
          },
          unexpectedPositionalHint: "Название папки указывается через --name <name>.",
          run(input) {
            return guard(async () => {
              const parentAddress = input.options.parent;
              const parent = parentAddress
                ? await resolveFolder(domain, parentAddress)
                : undefined;
              const result = tasksRpcContract.createFolder.output.parse(
                await domain.createFolder(
                  tasksRpcContract.createFolder.input.parse({
                    name: input.options.name,
                    parentFolderId: parent?.id ?? null,
                  }),
                ),
              );
              return input.options.json
                ? JSON.stringify(result)
                : `Папка создана: ${result.folder.name}  ${result.folder.id}`;
            });
          },
        }),
        "folder list": cliCommand({
          summary: "Показать папки проектов",
          options: { json: JSON_OPTION },
          run(input) {
            return guard(async () => {
              const result = tasksRpcContract.listFolders.output.parse(
                await domain.listFolders(
                  tasksRpcContract.listFolders.input.parse(null),
                ),
              );
              const names = new Map(
                result.folders.map((folder) => [folder.id, folder.name]),
              );
              return input.options.json
                ? JSON.stringify(result)
                : table(
                    ["НАЗВАНИЕ", "РОДИТЕЛЬ", "ID"],
                    result.folders.map((folder) => [
                      folder.name,
                      folder.parentFolderId
                        ? (names.get(folder.parentFolderId) ??
                          folder.parentFolderId)
                        : "-",
                      folder.id,
                    ]),
                    "Папок нет.",
                  );
            });
          },
        }),
        "folder update": cliCommand({
          summary: "Переименовать или переместить папку проекта",
          positionals: [
            {
              name: "id-or-name",
              description: "Идентификатор папки или её уникальное название",
              required: true,
            },
          ],
          options: {
            name: { type: "string", description: "Новое название папки" },
            parent: {
              type: "string",
              placeholder: "id-or-name",
              description: "Идентификатор или название новой родительской папки",
            },
            "no-parent": {
              type: "boolean",
              description: "Переместить папку на верхний уровень",
            },
            json: JSON_OPTION,
          },
          constraints: [
            { kind: "at-most-one", options: ["parent", "no-parent"] },
          ],
          run(input) {
            return guard(async () => {
              const folder = await resolveFolder(
                domain,
                input.positionals["id-or-name"],
              );
              const parentAddress = input.options.parent;
              const noParent = input.options["no-parent"];
              const name = input.options.name;
              if (
                name === undefined &&
                parentAddress === undefined &&
                !noParent
              ) {
                throw new CliError("изменения папки не указаны", {
                  code: "no_changes",
                });
              }
              const parent = parentAddress
                ? await resolveFolder(domain, parentAddress)
                : null;
              const renameInput =
                name === undefined
                  ? undefined
                  : tasksRpcContract.renameFolder.input.parse({
                      folderId: folder.id,
                      name,
                    });
              const moveInput =
                parentAddress === undefined && !noParent
                  ? undefined
                  : tasksRpcContract.moveFolder.input.parse({
                      folderId: folder.id,
                      parentFolderId: parent?.id ?? null,
                    });
              const updated = store.transaction(() =>
                store.tasks.updateFolder(folder.id, {
                  name: renameInput?.name,
                  parentFolderId: moveInput?.parentFolderId,
                }),
              );
              invalidateFolders(bb, { projectsMoved: false });
              return input.options.json
                ? JSON.stringify({ folder: updated })
                : `Папка обновлена: ${updated.name}  ${updated.id}`;
            });
          },
        }),
        "folder delete": cliCommand({
          summary: "Удалить папку и переместить её содержимое на верхний уровень",
          description:
            "При удалении папки её проекты и вложенные папки перемещаются на верхний уровень. Задачи не удаляются.",
          positionals: [
            {
              name: "id-or-name",
              description: "Идентификатор папки или её уникальное название",
              required: true,
            },
          ],
          options: { json: JSON_OPTION },
          run(input) {
            return guard(async () => {
              const address = input.positionals["id-or-name"];
              const folder = await resolveFolder(domain, address);
              const result = tasksRpcContract.deleteFolder.output.parse(
                await domain.deleteFolder(
                  tasksRpcContract.deleteFolder.input.parse({
                    folderId: folder.id,
                  }),
                ),
              );
              if (!result.deleted) {
                throw new CliError(
                  `Папка не найдена: ${address} (удалена другим клиентом)`,
                  { code: "folder_not_found" },
                );
              }
              if (input.options.json) {
                return JSON.stringify({ ...result, folder });
              }
              const projectCount = result.movedProjectIds.length;
              const folderCount = result.movedFolderIds.length;
              const moved = [
                projectCount > 0
                  ? `проектов: ${projectCount}`
                  : null,
                folderCount > 0
                  ? `вложенных папок: ${folderCount}`
                  : null,
              ].filter((part) => part !== null);
              return moved.length === 0
                ? `Папка удалена: ${folder.name}`
                : `Папка удалена: ${folder.name}; на верхний уровень перемещены ${moved.join(", ")}. Задачи не удалены.`;
            });
          },
        }),

        create: cliCommand({
          summary: "Создать задачу",
          unexpectedPositionalHint:
            "Название задачи указывается через --title <title>.",
          options: {
            project: PROJECT_OPTION,
            title: {
              type: "string",
              required: true,
              aliases: ["name", "subject"],
              description: "Название задачи",
            },
            description: {
              type: "string",
              placeholder: "markdown",
              aliases: ["body", "details", "text", "content"],
              description:
                "Описание в Markdown; для длинного текста используйте --description-file",
            },
            "description-file": {
              type: "string",
              placeholder: "path",
              description:
                "Прочитать описание из этого файла UTF-8 на машине вызова",
            },
            priority: {
              type: "enum",
              values: TASK_PRIORITIES,
              default: "none",
              description: "Приоритет задачи",
            },
            label: {
              type: "string",
              repeatable: true,
              split: ",",
              placeholder: "name",
              aliases: ["labels"],
              description:
                "Название существующей метки; повторите параметр или разделите значения запятыми",
            },
            due: {
              type: "string",
              placeholder: "YYYY-MM-DD",
              aliases: ["due-date"],
              description: "Срок в виде календарной даты YYYY-MM-DD",
            },
            parent: {
              type: "string",
              placeholder: "key-or-id",
              description:
                "Ключ или идентификатор родительской задачи; поддерживается не более одного уровня подзадач",
            },
            attach: {
              type: "string",
              repeatable: true,
              placeholder: "path",
              aliases: ["file", "attachment"],
              description:
                "Файл для вложения; параметр можно повторять. Читается с машины вызова, до 25 МБ на файл",
            },
            machine: MACHINE_OPTION,
            json: JSON_OPTION,
          },
          constraints: [
            {
              kind: "at-most-one",
              options: ["description", "description-file"],
            },
          ],
          run(input, ctx) {
            return guard(async () => {
              const attachPaths = input.options.attach.map((path) =>
                resolveClientPath(ctx.cwd ?? process.cwd(), path),
              );
              const descriptionFile = input.options["description-file"];
              const usesClientFiles =
                attachPaths.length > 0 || descriptionFile !== undefined;
              if (input.options.machine !== undefined && !usesClientFiles) {
                throw new CliError(
                  "Для --machine требуется --attach или --description-file",
                );
              }
              const clientHostId = usesClientFiles
                ? await resolveClientHostId(
                    bb,
                    domain,
                    input.options.machine,
                    ctx,
                  )
                : undefined;
              const attachSources: Array<{ path: string; bytes: Buffer }> = [];
              for (const path of attachPaths) {
                attachSources.push({
                  path,
                  bytes: await readAttachmentSource(bb, clientHostId, path),
                });
              }
              const project = await selectedProject(
                domain,
                ctx,
                input.options.project,
                true,
              );
              if (!project) throw new CliError("требуется проект");
              const labels = await projectLabels(domain, project.id);
              const labelIds = input.options.label.map(
                (name) => resolveLabel(labels, name).id,
              );
              const parentAddress = input.options.parent;
              const parent = parentAddress
                ? await resolveTask(domain, parentAddress)
                : undefined;
              const created = tasksRpcContract.createTask.input.parse({
                projectId: project.id,
                title: input.options.title,
                description:
                  (await readTextOption(
                    bb,
                    ctx,
                    clientHostId,
                    input.options.description,
                    descriptionFile,
                  )) ?? "",
                priority: input.options.priority,
                dueDate: input.options.due ?? null,
                parentTaskId: parent?.id ?? null,
                labelIds,
              });
              const task = unwrapTask(
                tasksRpcContract.createTask.output.parse(
                  await domain.createTask(created),
                ),
              );
              const attachments: Attachment[] = [];
              const failedAttachments: Array<{ path: string; error: string }> =
                [];
              for (const source of attachSources) {
                try {
                  const attachment = await saveAttachmentFromBytes(
                    store.tasks,
                    source.bytes,
                    {
                      taskId: task.id,
                      fileName: attachmentFileName(source.path),
                    },
                  );
                  invalidateAttachmentChanged(bb, store.tasks, attachment);
                  attachments.push(attachment);
                } catch (error) {
                  failedAttachments.push({
                    path: source.path,
                    error: errorMessage(error),
                  });
                }
              }
              const stdout = input.options.json
                ? JSON.stringify({ task, attachments, failedAttachments })
                : [
                    `Задача создана: ${task.key}  ${task.title}`,
                    ...attachments.map(
                      (attachment) =>
                        `Прикреплено: ${attachment.fileName}  ${attachment.id}`,
                    ),
                    ...failedAttachments.map(
                      (entry) =>
                        `Не удалось прикрепить ${entry.path}: ${entry.error}`,
                    ),
                    ...failedAttachments.map(
                      (entry) =>
                        `Повторите командой: bb tasks attachment add ${task.key} --file ${entry.path}`,
                    ),
                  ].join("\n");
              if (failedAttachments.length === 0) return stdout;
              return {
                exitCode: 1,
                stdout,
                stderr: `Задача ${task.key} создана, но не удалось загрузить вложения (${failedAttachments.length} из ${attachPaths.length}); команды для повторной попытки приведены в stdout`,
              };
            });
          },
        }),

        list: cliCommand({
          summary: "Показать и отфильтровать задачи",
          options: {
            project: PROJECT_OPTION,
            status: {
              type: "enum",
              values: TASK_STATUSES,
              repeatable: true,
              split: ",",
              aliases: ["statuses", "state"],
              description:
                "Оставить только задачи с этими статусами; повторите параметр или разделите значения запятыми",
            },
            priority: {
              type: "enum",
              values: TASK_PRIORITIES,
              repeatable: true,
              split: ",",
              aliases: ["priorities"],
              description:
                "Оставить только задачи с этими приоритетами; повторите параметр или разделите значения запятыми",
            },
            label: {
              type: "string",
              repeatable: true,
              split: ",",
              placeholder: "name",
              aliases: ["labels"],
              description:
                "Оставить только задачи с этими метками; повторите параметр или разделите значения запятыми",
            },
            active: {
              type: "boolean",
              description: "Показывать только задачи с активным чатом агента",
            },
            search: {
              type: "string",
              placeholder: "query",
              aliases: ["query", "q"],
              description: "Поиск по названию и описанию",
            },
            sort: {
              type: "enum",
              values: TASK_SORTS,
              default: "manual",
              description: "Порядок строк",
            },
            limit: {
              type: "integer",
              min: 1,
              max: TASKS_PAGE_MAX_LIMIT,
              default: TASKS_PAGE_DEFAULT_LIMIT,
              description: "Строк на странице",
            },
            cursor: {
              type: "string",
              placeholder: "opaque",
              description:
                "Продолжить с nextCursor предыдущей страницы при тех же фильтрах",
            },
            json: JSON_OPTION,
          },
          run(input, ctx) {
            return guard(async () => {
              const project = await selectedProject(
                domain,
                ctx,
                input.options.project,
                false,
              );
              const projects = project ? [project] : await listProjects(domain);
              const labelById = await labelsForTaskList(domain, projects);
              const labelIds = input.options.label.map((name) => {
                const matches = [...labelById.values()].filter(
                  (label) =>
                    label.name.toLowerCase() === name.trim().toLowerCase(),
                );
                if (matches.length === 0) {
                  throw new CliError(`метка не найдена: ${name}`, {
                    code: "label_not_found",
                  });
                }
                if (matches.length > 1 && !project) {
                  throw new CliError(
                    `Метка «${name}» есть в нескольких проектах; укажите --project`,
                    { code: "label_ambiguous" },
                  );
                }
                return matches[0]!.id;
              });
              const limit = input.options.limit;
              const result = tasksRpcContract.listTasks.output.parse(
                await domain.listTasks(
                  tasksRpcContract.listTasks.input.parse({
                    projectId: project?.id,
                    statuses:
                      input.options.status.length > 0
                        ? input.options.status
                        : undefined,
                    priorities:
                      input.options.priority.length > 0
                        ? input.options.priority
                        : undefined,
                    labelIds: labelIds.length > 0 ? labelIds : undefined,
                    activeOnly: input.options.active,
                    search: input.options.search,
                    sort: input.options.sort,
                    limit,
                    cursor: input.options.cursor,
                  }),
                ),
              );
              const tasks = [];
              for (const task of result.tasks) {
                const threadResult =
                  tasksRpcContract.listTaskThreads.output.parse(
                    await domain.listTaskThreads(
                      tasksRpcContract.listTaskThreads.input.parse({
                        taskId: task.id,
                      }),
                    ),
                  );
                tasks.push({
                  ...task,
                  labels: task.labelIds.map(
                    (id) => labelById.get(id)?.name ?? id,
                  ),
                  agentsWorking: threadResult.taskThreads.filter((thread) =>
                    ACTIVE_THREAD_STATUSES.has(thread.liveStatus),
                  ).length,
                });
              }
              if (input.options.json) {
                return JSON.stringify({
                  tasks,
                  nextCursor: result.nextCursor,
                  limit,
                });
              }
              const output = table(
                [
                  "КЛЮЧ",
                  "СТАТУС",
                  "ПРИОРИТЕТ",
                  "СРОК",
                  "НАЗВАНИЕ",
                  "МЕТКИ",
                  "АГЕНТЫ",
                ],
                tasks.map((task) => [
                  task.key,
                  task.status,
                  task.priority,
                  task.dueDate ?? "-",
                  task.title,
                  task.labels.join(", ") || "-",
                  task.agentsWorking,
                ]),
                "Задач нет.",
              );
              return result.nextCursor === null
                ? output
                : `${output}\n\nДоступны дополнительные результаты. Повторите запрос с теми же фильтрами и добавьте: --limit ${limit} --cursor ${result.nextCursor}`;
            });
          },
        }),

        show: cliCommand({
          summary: "Показать все сведения о задаче",
          aliases: ["get"],
          suggestFor: ["view", "read", "info", "detail", "details", "describe"],
          positionals: [KEY_POSITIONAL],
          options: { json: JSON_OPTION },
          run(input) {
            return guard(async () => {
              const task = await resolveTask(
                domain,
                input.positionals["key-or-id"],
              );
              const project = await resolveProject(domain, task.projectId);
              const allLabels = await projectLabels(domain, project.id);
              const labelById = new Map(
                allLabels.map((label) => [label.id, label]),
              );
              const labels = task.labelIds
                .map((id) => labelById.get(id)!)
                .filter(Boolean);
              const subtasks = await listAllTasks(
                domain,
                tasksRpcContract.listTasks.input.parse({
                  parentTaskId: task.id,
                }),
              );
              const comments = tasksRpcContract.listComments.output.parse(
                await domain.listComments(
                  tasksRpcContract.listComments.input.parse({
                    taskId: task.id,
                  }),
                ),
              ).comments;
              const attachments = await listTaskAttachments(
                domain,
                task.id,
                comments,
              );
              const taskThreads = tasksRpcContract.listTaskThreads.output.parse(
                await domain.listTaskThreads(
                  tasksRpcContract.listTaskThreads.input.parse({
                    taskId: task.id,
                  }),
                ),
              ).taskThreads;
              const { pullRequests, unavailableThreadIds } =
                tasksRpcContract.listTaskPullRequests.output.parse(
                  await domain.listTaskPullRequests(
                    tasksRpcContract.listTaskPullRequests.input.parse({
                      taskId: task.id,
                    }),
                  ),
                );
              if (input.options.json) {
                return JSON.stringify({
                  task,
                  project,
                  labels,
                  subtasks,
                  attachments,
                  taskThreads,
                  pullRequests,
                  pullRequestUnavailableThreadIds: unavailableThreadIds,
                  comments,
                });
              }
              return [
                detail([
                  ["Задача", `${task.key} — ${task.title}`],
                  ["ID", task.id],
                  ["Проект", `${project.prefix} — ${project.name}`],
                  ["Статус", task.status],
                  ["Приоритет", task.priority],
                  ["Срок", task.dueDate ?? "-"],
                  ["Родительская задача", task.parentTaskId ?? "-"],
                  [
                    "Метки",
                    labels.map((label) => label.name).join(", ") || "-",
                  ],
                  ["Создано", task.createdAt],
                  ["Обновлено", task.updatedAt],
                ]),
                `Описание\n${task.description || "(нет)"}`,
                `Подзадачи\n${table(
                  ["КЛЮЧ", "СТАТУС", "ПРИОРИТЕТ", "НАЗВАНИЕ"],
                  subtasks.map((subtask) => [
                    subtask.key,
                    subtask.status,
                    subtask.priority,
                    subtask.title,
                  ]),
                  "(нет)",
                )}`,
                `Вложения\n${table(
                  ["ID", "НАЗВАНИЕ", "РАЗМЕР"],
                  attachments.map((attachment) => [
                    attachment.id,
                    attachment.fileName,
                    bytes(attachment.sizeBytes),
                  ]),
                  "(нет)",
                )}`,
                `Прикреплённые чаты\n${table(
                  ["ЧАТ", "СТАТУС", "ПРЕСЕТ", "НАЗВАНИЕ"],
                  taskThreads.map((thread) => [
                    thread.threadId,
                    thread.liveStatus,
                    thread.presetName,
                    thread.title,
                  ]),
                  "(нет)",
                )}`,
                `Запросы на слияние\n${table(
                  ["PR", "СОСТОЯНИЕ", "НАЗВАНИЕ", "URL"],
                  pullRequests.map((pullRequest) => [
                    `#${pullRequest.number}`,
                    pullRequest.state,
                    pullRequest.title,
                    pullRequest.url,
                  ]),
                  "(нет)",
                )}${
                  unavailableThreadIds.length > 0
                    ? `\nПроверка запросов на слияние недоступна для: ${unavailableThreadIds.join(", ")}`
                    : ""
                }`,
                `Комментарии\n${table(
                  ["ВРЕМЯ", "ТИП", "АВТОР", "ПРОВАЙДЕР", "ТЕКСТ"],
                  comments.map((comment) => [
                    comment.createdAt,
                    comment.kind,
                    comment.threadTitle ?? comment.authorName,
                    comment.provider?.name ?? "-",
                    comment.body,
                  ]),
                  "(нет)",
                )}`,
              ].join("\n\n");
            });
          },
        }),

        update: cliCommand({
          summary: "Изменить поля и метки задачи",
          positionals: [KEY_POSITIONAL],
          options: {
            status: {
              type: "enum",
              values: TASK_STATUSES,
              aliases: ["state"],
              description:
                "Новый статус: in_review, когда требуется проверка; done, когда критерии выполнены",
            },
            priority: {
              type: "enum",
              values: TASK_PRIORITIES,
              description: "Новый приоритет",
            },
            title: {
              type: "string",
              aliases: ["name", "subject"],
              description: "Новое название",
            },
            description: {
              type: "string",
              placeholder: "markdown",
              aliases: ["body", "details", "text", "content"],
              description:
                "Новое описание в Markdown; для длинного текста используйте --description-file",
            },
            "description-file": {
              type: "string",
              placeholder: "path",
              description:
                "Прочитать новое описание из этого файла UTF-8 на машине вызова",
            },
            due: {
              type: "string",
              placeholder: "YYYY-MM-DD",
              aliases: ["due-date"],
              description: "Новый срок в виде календарной даты YYYY-MM-DD",
            },
            "no-due": { type: "boolean", description: "Очистить срок" },
            parent: {
              type: "string",
              placeholder: "key-or-id",
              description:
                "Ключ или идентификатор новой родительской задачи; поддерживается не более одного уровня подзадач",
            },
            "no-parent": {
              type: "boolean",
              description: "Переместить задачу на верхний уровень",
            },
            "add-label": {
              type: "string",
              repeatable: true,
              split: ",",
              placeholder: "name",
              description:
                "Название существующей метки для добавления; повторите параметр или разделите значения запятыми",
            },
            "remove-label": {
              type: "string",
              repeatable: true,
              split: ",",
              placeholder: "name",
              description: "Название метки для удаления; повторите параметр или разделите значения запятыми",
            },
            machine: MACHINE_OPTION,
            json: JSON_OPTION,
          },
          constraints: [
            {
              kind: "at-most-one",
              options: ["description", "description-file"],
            },
            { kind: "at-most-one", options: ["due", "no-due"] },
            { kind: "at-most-one", options: ["parent", "no-parent"] },
            {
              kind: "requires",
              option: "machine",
              needs: ["description-file"],
            },
          ],
          run(input, ctx) {
            return guard(async () => {
              const task = await resolveTask(
                domain,
                input.positionals["key-or-id"],
              );
              const dueDate = input.options.due;
              const noDue = input.options["no-due"];
              const parentAddress = input.options.parent;
              const noParent = input.options["no-parent"];
              const parent =
                parentAddress === undefined
                  ? undefined
                  : await resolveTask(domain, parentAddress);
              const descriptionFile = input.options["description-file"];
              const clientHostId =
                descriptionFile !== undefined
                  ? await resolveClientHostId(
                      bb,
                      domain,
                      input.options.machine,
                      ctx,
                    )
                  : undefined;
              const description = await readTextOption(
                bb,
                ctx,
                clientHostId,
                input.options.description,
                descriptionFile,
              );
              const labels = await projectLabels(domain, task.projectId);
              const nextLabels = new Set(task.labelIds);
              for (const name of input.options["add-label"]) {
                nextLabels.add(resolveLabel(labels, name).id);
              }
              for (const name of input.options["remove-label"]) {
                nextLabels.delete(resolveLabel(labels, name).id);
              }
              const labelsChanged =
                input.options["add-label"].length > 0 ||
                input.options["remove-label"].length > 0;
              if (
                input.options.status === undefined &&
                input.options.priority === undefined &&
                input.options.title === undefined &&
                description === undefined &&
                dueDate === undefined &&
                !noDue &&
                parentAddress === undefined &&
                !noParent &&
                !labelsChanged
              ) {
                throw new CliError("изменения задачи не указаны", {
                  code: "no_changes",
                });
              }
              const result = tasksRpcContract.updateTask.output.parse(
                await domain.updateTask(
                  tasksRpcContract.updateTask.input.parse({
                    taskId: task.id,
                    status: input.options.status,
                    priority: input.options.priority,
                    title: input.options.title,
                    description,
                    dueDate: noDue ? null : dueDate,
                    parentTaskId:
                      parentAddress === undefined && !noParent
                        ? undefined
                        : (parent?.id ?? null),
                    labelIds: labelsChanged ? [...nextLabels] : undefined,
                    authorName: taskAuthor(ctx),
                  }),
                ),
              );
              const updated = unwrapTask(result);
              return input.options.json
                ? JSON.stringify({ task: updated })
                : `Задача обновлена: ${updated.key}  ${updated.title}`;
            });
          },
        }),

        move: cliCommand({
          summary: "Переместить задачу и её подзадачи в другой проект",
          description:
            "Перемещённые задачи получают новые ключи в целевом проекте; старые ключи продолжают работать. Метки сопоставляются по названию и при необходимости создаются. Отдельно перемещённая подзадача открепляется от родителя.",
          positionals: [KEY_POSITIONAL],
          options: {
            project: REQUIRED_PROJECT_OPTION,
            json: JSON_OPTION,
          },
          run(input, ctx) {
            return guard(async () => {
              const task = await resolveTask(
                domain,
                input.positionals["key-or-id"],
              );
              const project = await requiredProject(
                domain,
                ctx,
                input.options.project,
              );
              const result = tasksRpcContract.moveTaskToProject.output.parse(
                await domain.moveTaskToProject(
                  tasksRpcContract.moveTaskToProject.input.parse({
                    taskId: task.id,
                    projectId: project.id,
                    authorName: taskAuthor(ctx),
                  }),
                ),
              );
              const moved = unwrapTask(result);
              if (input.options.json) {
                return JSON.stringify({ task: moved, previousKey: task.key });
              }
              return moved.key === task.key
                ? `${task.key} is already in ${project.prefix}`
                : `Задача ${task.key} перемещена: ${moved.key}  ${moved.title}`;
            });
          },
        }),

        comment: cliCommand({
          summary: "Добавить к задаче комментарий в Markdown",
          positionals: [KEY_POSITIONAL],
          options: {
            body: {
              type: "string",
              placeholder: "markdown",
              aliases: ["message", "text", "content"],
              description:
                "Текст комментария в Markdown; для длинного текста используйте --body-file (ровно один из этих параметров)",
            },
            "body-file": {
              type: "string",
              placeholder: "path",
              description:
                "Прочитать комментарий из файла UTF-8 на машине вызова",
            },
            author: {
              type: "string",
              placeholder: "name",
              description:
                "Отображаемое имя автора комментария; по умолчанию вызвавший чат или cli",
            },
            notify: {
              type: "boolean",
              description:
                "Отправить комментарий в чат, из которого пришёл последний ответ агента по задаче",
            },
            machine: MACHINE_OPTION,
            json: JSON_OPTION,
          },
          constraints: [
            { kind: "exactly-one", options: ["body", "body-file"] },
            { kind: "requires", option: "machine", needs: ["body-file"] },
          ],
          run(input, ctx) {
            return guard(async () => {
              const task = await resolveTask(
                domain,
                input.positionals["key-or-id"],
              );
              const bodyFile = input.options["body-file"];
              const clientHostId =
                bodyFile !== undefined
                  ? await resolveClientHostId(
                      bb,
                      domain,
                      input.options.machine,
                      ctx,
                    )
                  : undefined;
              const body = await readTextOption(
                bb,
                ctx,
                clientHostId,
                input.options.body,
                bodyFile,
              );
              if (body === undefined) {
                throw new CliError("требуется --body или --body-file", {
                  code: "missing_required",
                });
              }
              if (!body.trim()) {
                throw new CliError("текст комментария не может быть пустым");
              }
              const comment = await createComment(bb, store, {
                taskId: task.id,
                kind: ctx.threadId ? "agent" : "user",
                authorName: input.options.author ?? taskAuthor(ctx),
                presetName: null,
                threadId: ctx.threadId ?? null,
                body,
                notify: input.options.notify,
                awaitDelivery: true,
              });
              return input.options.json
                ? JSON.stringify({ comment })
                : `Комментарий к ${task.key} добавлен: ${comment.id}`;
            });
          },
        }),

        label: groupCommand("label", "Создать, показать или удалить метки проекта", [
          ["create", "Создать метку проекта"],
          ["list", "Показать метки проекта"],
          ["delete", "Удалить метку"],
        ]),
        "label create": cliCommand({
          summary: "Создать метку проекта",
          options: {
            project: REQUIRED_PROJECT_OPTION,
            name: { type: "string", required: true, description: "Название метки" },
            color: {
              type: "string",
              default: DEFAULT_LABEL_COLOR,
              description: "Название цвета метки",
            },
            json: JSON_OPTION,
          },
          unexpectedPositionalHint: "Название метки указывается через --name <name>.",
          run(input, ctx) {
            return guard(async () => {
              const project = await requiredProject(
                domain,
                ctx,
                input.options.project,
              );
              const result = tasksRpcContract.createLabel.output.parse(
                await domain.createLabel(
                  tasksRpcContract.createLabel.input.parse({
                    projectId: project.id,
                    name: input.options.name,
                    color: input.options.color,
                  }),
                ),
              );
              return input.options.json
                ? JSON.stringify(result)
                : `Метка создана: ${result.label.name}  ${result.label.id}`;
            });
          },
        }),
        "label list": cliCommand({
          summary: "Показать метки проекта",
          options: { project: REQUIRED_PROJECT_OPTION, json: JSON_OPTION },
          run(input, ctx) {
            return guard(async () => {
              const project = await requiredProject(
                domain,
                ctx,
                input.options.project,
              );
              const labels = await projectLabels(domain, project.id);
              return input.options.json
                ? JSON.stringify({ labels })
                : table(
                    ["НАЗВАНИЕ", "ЦВЕТ", "ID"],
                    labels.map((label) => [label.name, label.color, label.id]),
                    "Меток нет.",
                  );
            });
          },
        }),
        "label delete": cliCommand({
          summary: "Удалить метку проекта",
          positionals: [
            {
              name: "name-or-id",
              description: "Название метки или её ULID",
              required: true,
            },
          ],
          options: { project: REQUIRED_PROJECT_OPTION, json: JSON_OPTION },
          run(input, ctx) {
            return guard(async () => {
              const project = await requiredProject(
                domain,
                ctx,
                input.options.project,
              );
              const label = resolveLabel(
                await projectLabels(domain, project.id),
                input.positionals["name-or-id"],
              );
              const result = tasksRpcContract.deleteLabel.output.parse(
                await domain.deleteLabel(
                  tasksRpcContract.deleteLabel.input.parse({
                    labelId: label.id,
                  }),
                ),
              );
              return input.options.json
                ? JSON.stringify({ ...result, label })
                : `Метка удалена: ${label.name}`;
            });
          },
        }),

        attachment: groupCommand(
          "attachment",
          "Добавить, скачать, показать или удалить вложения задачи",
          [
            ["add", "Прикрепить файл к задаче или комментарию"],
            ["get", "Скачать вложение по указанному пути"],
            ["list", "Показать вложения задачи"],
            ["remove", "Удалить вложение"],
          ],
        ),
        "attachment add": cliCommand({
          summary: "Прикрепить файл к задаче или комментарию",
          description:
            "Файлы читаются с машины вызова: из машины чата агента либо с сервера.",
          positionals: [
            {
              name: "key-or-comment-id",
              description:
                "Ключ задачи, например ABC-12, ULID задачи или ULID комментария",
              required: true,
            },
          ],
          options: {
            file: {
              type: "string",
              required: true,
              placeholder: "path",
              aliases: ["path", "attach"],
              description: "Исходный файл для загрузки, до 25 МБ",
            },
            name: {
              type: "string",
              description: "Название сохранённого файла; по умолчанию имя исходного файла",
            },
            machine: MACHINE_OPTION,
            json: JSON_OPTION,
          },
          run(input, ctx) {
            return guard(async () => {
              const ownerAddress = input.positionals["key-or-comment-id"];
              const sourcePath = resolveClientPath(
                ctx.cwd ?? process.cwd(),
                input.options.file,
              );
              const normalizedOwner = ownerAddress.trim().toUpperCase();
              const comment = ULID_PATTERN.test(normalizedOwner)
                ? store.tasks.getComment(normalizedOwner)
                : undefined;
              if (ULID_PATTERN.test(normalizedOwner) && !comment) {
                throw new CliError(`комментарий не найден: ${ownerAddress}`, {
                  code: "comment_not_found",
                });
              }
              const owner = comment
                ? { commentId: comment.id }
                : { taskId: (await resolveTask(domain, ownerAddress)).id };
              const clientHostId = await resolveClientHostId(
                bb,
                domain,
                input.options.machine,
                ctx,
              );
              const content = await readAttachmentSource(
                bb,
                clientHostId,
                sourcePath,
              );
              const attachment = await saveAttachmentFromBytes(
                store.tasks,
                content,
                {
                  ...owner,
                  fileName:
                    input.options.name ?? attachmentFileName(sourcePath),
                },
              );
              invalidateAttachmentChanged(bb, store.tasks, attachment);
              return input.options.json
                ? JSON.stringify({
                    attachment,
                    url: attachmentDownloadUrl(attachment.id),
                  })
                : `Вложение добавлено: ${attachment.fileName}  ${attachment.id}`;
            });
          },
        }),
        "attachment get": cliCommand({
          summary: "Скачать вложение по указанному пути",
          description:
            "Файл записывается на машину вызова: на машину чата агента либо на сервер.",
          positionals: [
            {
              name: "attachment-id",
              description: "ULID вложения из bb tasks attachment list",
              required: true,
            },
          ],
          options: {
            out: {
              type: "string",
              required: true,
              placeholder: "path",
              short: "o",
              aliases: ["output", "to"],
              description:
                "Путь назначения; недостающие родительские папки будут созданы",
            },
            machine: MACHINE_OPTION,
            json: JSON_OPTION,
          },
          run(input, ctx) {
            return guard(async () => {
              const outPath = resolveClientPath(
                ctx.cwd ?? process.cwd(),
                input.options.out,
              );
              const clientHostId = await resolveClientHostId(
                bb,
                domain,
                input.options.machine,
                ctx,
              );
              const { attachment, content } = await readAttachmentContent(
                store.tasks,
                input.positionals["attachment-id"],
              );
              await writeClientFile(bb, clientHostId, outPath, content);
              return input.options.json
                ? JSON.stringify({ attachment, out: outPath })
                : `Файл сохранён: ${attachment.fileName}  ${outPath}`;
            });
          },
        }),
        "attachment list": cliCommand({
          summary: "Показать вложения задачи",
          positionals: [KEY_POSITIONAL],
          options: { json: JSON_OPTION },
          run(input) {
            return guard(async () => {
              const task = await resolveTask(
                domain,
                input.positionals["key-or-id"],
              );
              const comments = tasksRpcContract.listComments.output.parse(
                await domain.listComments(
                  tasksRpcContract.listComments.input.parse({
                    taskId: task.id,
                  }),
                ),
              ).comments;
              const attachments = await listTaskAttachments(
                domain,
                task.id,
                comments,
              );
              return input.options.json
                ? JSON.stringify({ task, attachments })
                : table(
                    ["ID", "НАЗВАНИЕ", "ТИП", "РАЗМЕР"],
                    attachments.map((attachment) => [
                      attachment.id,
                      attachment.fileName,
                      attachment.mime,
                      bytes(attachment.sizeBytes),
                    ]),
                    "Вложений нет.",
                  );
            });
          },
        }),
        "attachment remove": cliCommand({
          summary: "Удалить вложение",
          positionals: [
            {
              name: "attachment-id",
              description: "ULID вложения из bb tasks attachment list",
              required: true,
            },
          ],
          options: {
            "remove-references": {
              type: "boolean",
              description:
                "Также удалить ссылки на вложение из описания задачи",
            },
            json: JSON_OPTION,
          },
          run(input) {
            return guard(async () => {
              const attachmentId = input.positionals["attachment-id"];
              const result = tasksRpcContract.deleteAttachment.output.parse(
                await domain.deleteAttachment(
                  tasksRpcContract.deleteAttachment.input.parse({
                    attachmentId: attachmentId.trim(),
                    removeDescriptionReferences:
                      input.options["remove-references"],
                  }),
                ),
              );
              if (!result.ok) throw new CliError(result.error.message);
              if (!result.deleted) {
                throw new CliError(`вложение не найдено: ${attachmentId}`, {
                  code: "attachment_not_found",
                });
              }
              return input.options.json
                ? JSON.stringify({
                    deleted: true,
                    attachment: result.attachment,
                  })
                : `Вложение удалено: ${result.attachment.fileName}  ${result.attachment.id}`;
            });
          },
        }),

        preset: groupCommand(
          "preset",
          "Показать, создать, изменить или удалить пресеты запуска",
          [
            ["list", "Показать пресеты запуска"],
            ["show", "Показать пресет"],
            ["create", "Создать пресет"],
            ["update", "Изменить пресет"],
            ["delete", "Удалить пресет"],
          ],
        ),
        "preset list": cliCommand({
          summary: "Показать пресеты запуска",
          options: { json: JSON_OPTION },
          run(input) {
            return guard(async () => {
              const presets = await listPresets(domain);
              return input.options.json
                ? JSON.stringify({ presets })
                : table(
                    [
                      "НАЗВАНИЕ",
                      "ПРОВАЙДЕР",
                      "МОДЕЛЬ",
                      "РАССУЖДЕНИЯ",
                      "УРОВЕНЬ СЕРВИСА",
                      "РАЗРЕШЕНИЯ",
                      "ОКРУЖЕНИЕ",
                      "БАЗОВАЯ ВЕТКА",
                      "МАШИНА",
                      "ВСТРОЕННЫЙ",
                      "ID",
                    ],
                    presets.map((preset) => [
                      preset.name,
                      preset.providerId,
                      preset.modelId,
                      preset.reasoningLevel,
                      preset.serviceTier ?? "-",
                      preset.permissionMode,
                      presetEnvironmentLabel(preset),
                      preset.baseBranch ?? "-",
                      preset.machineId ?? "-",
                      preset.builtin ? "yes" : "no",
                      preset.id,
                    ]),
                    "Пресетов нет.",
                  );
            });
          },
        }),
        "preset show": cliCommand({
          summary: "Показать пресет запуска",
          positionals: [
            {
              name: "name-or-id",
              description: "Название пресета (без учёта регистра) или его ULID",
              required: true,
            },
          ],
          options: { json: JSON_OPTION },
          run(input) {
            return guard(async () => {
              const preset = resolvePreset(
                await listPresets(domain),
                input.positionals["name-or-id"],
              );
              return input.options.json
                ? JSON.stringify({ preset })
                : detail([
                    ["Название", preset.name],
                    ["Провайдер", preset.providerId],
                    ["Модель", preset.modelId],
                    ["Рассуждения", preset.reasoningLevel],
                    ["Уровень сервиса", preset.serviceTier ?? "-"],
                    ["Разрешения", preset.permissionMode],
                    ["Окружение", presetEnvironmentLabel(preset)],
                    ["Базовая ветка", preset.baseBranch ?? "-"],
                    ["Машина", preset.machineId ?? "-"],
                    ["Инструкции", preset.instructions || "-"],
                    ["Встроенный", preset.builtin ? "yes" : "no"],
                    ["ID", preset.id],
                  ]);
            });
          },
        }),
        "preset create": cliCommand({
          summary: "Создать пресет запуска",
          options: {
            name: {
              type: "string",
              required: true,
              description: "Название пресета в меню запуска",
            },
            provider: {
              type: "string",
              required: true,
              placeholder: "id",
              description: "Идентификатор провайдера, например codex или claude-code",
            },
            model: {
              type: "string",
              required: true,
              placeholder: "id",
              description: "Идентификатор модели в формате провайдера",
            },
            reasoning: {
              type: "string",
              required: true,
              placeholder: "level",
              description: "Идентификатор уровня рассуждений модели",
            },
            permission: {
              type: "enum",
              values: PRESET_PERMISSION_MODES,
              required: true,
              description: "Режим разрешений запущенного чата",
            },
            "service-tier": {
              type: "string",
              placeholder: "tier",
              description:
                "Идентификатор уровня сервиса модели, например default или fast",
            },
            "clear-service-tier": {
              type: "boolean",
              description: "Не задавать уровень сервиса пресета",
            },
            environment: {
              type: "enum",
              values: PRESET_ENVIRONMENTS,
              default: "project-default",
              description:
                "Где выполняется чат; для --base-branch и --machine требуется worktree",
            },
            "base-branch": {
              type: "string",
              placeholder: "branch",
              description: "Базовая ветка новых рабочих деревьев",
            },
            machine: {
              type: "string",
              placeholder: "id-or-name",
              description: "Зарегистрированная машина для рабочего дерева",
            },
            instructions: {
              type: "string",
              placeholder: "text",
              description: "Дополнительные инструкции перед каждым запуском",
            },
            json: JSON_OPTION,
          },
          run(input) {
            return guard(async () => {
              const environmentKind = presetEnvironmentKind(
                input.options.environment,
                "project-default",
              );
              const baseBranch = input.options["base-branch"];
              const machine = input.options.machine;
              validatePresetTargetOptions({
                environmentKind,
                baseBranch,
                machine,
              });
              const result = tasksRpcContract.createPreset.output.parse(
                await domain.createPreset(
                  tasksRpcContract.createPreset.input.parse({
                    name: input.options.name,
                    providerId: input.options.provider,
                    modelId: input.options.model,
                    reasoningLevel: input.options.reasoning,
                    serviceTier:
                      presetServiceTier(
                        input.options["service-tier"],
                        input.options["clear-service-tier"],
                      ) ?? null,
                    permissionMode: input.options.permission,
                    environmentKind,
                    baseBranch: baseBranch ?? null,
                    machineId:
                      machine === undefined
                        ? null
                        : await resolveMachineId(domain, machine),
                    instructions: input.options.instructions ?? "",
                  }),
                ),
              );
              return input.options.json
                ? JSON.stringify(result)
                : `Пресет создан: ${result.preset.name}  ${result.preset.id}`;
            });
          },
        }),
        "preset update": cliCommand({
          summary: "Изменить пресет запуска",
          positionals: [
            {
              name: "name-or-id",
              description: "Название пресета (без учёта регистра) или его ULID",
              required: true,
            },
          ],
          options: {
            name: { type: "string", description: "Новое название пресета" },
            provider: {
              type: "string",
              placeholder: "id",
              description: "Идентификатор провайдера, например codex или claude-code",
            },
            model: {
              type: "string",
              placeholder: "id",
              description: "Идентификатор модели в формате провайдера",
            },
            reasoning: {
              type: "string",
              placeholder: "level",
              description: "Идентификатор уровня рассуждений модели",
            },
            permission: {
              type: "enum",
              values: PRESET_PERMISSION_MODES,
              description: "Режим разрешений запущенного чата",
            },
            "service-tier": {
              type: "string",
              placeholder: "tier",
              description:
                "Идентификатор уровня сервиса модели, например default или fast",
            },
            "clear-service-tier": {
              type: "boolean",
              description: "Не задавать уровень сервиса пресета",
            },
            environment: {
              type: "enum",
              values: PRESET_ENVIRONMENTS,
              description:
                "Где выполняется чат; при выборе project-default значения --base-branch и --machine очищаются",
            },
            "base-branch": {
              type: "string",
              placeholder: "branch",
              description: "Базовая ветка новых рабочих деревьев",
            },
            machine: {
              type: "string",
              placeholder: "id-or-name",
              description: "Зарегистрированная машина для рабочего дерева",
            },
            instructions: {
              type: "string",
              placeholder: "text",
              description: "Дополнительные инструкции перед каждым запуском",
            },
            json: JSON_OPTION,
          },
          run(input) {
            return guard(async () => {
              const preset = resolvePreset(
                await listPresets(domain),
                input.positionals["name-or-id"],
              );
              const environmentOption = input.options.environment;
              const environmentKind = presetEnvironmentKind(
                environmentOption,
                preset.environmentKind,
              );
              const baseBranch = input.options["base-branch"];
              const machine = input.options.machine;
              validatePresetTargetOptions({
                environmentKind,
                baseBranch,
                machine,
              });
              const result = tasksRpcContract.updatePreset.output.parse(
                await domain.updatePreset(
                  tasksRpcContract.updatePreset.input.parse({
                    presetId: preset.id,
                    name: input.options.name,
                    providerId: input.options.provider,
                    modelId: input.options.model,
                    reasoningLevel: input.options.reasoning,
                    serviceTier: presetServiceTier(
                      input.options["service-tier"],
                      input.options["clear-service-tier"],
                    ),
                    permissionMode: input.options.permission,
                    environmentKind:
                      environmentOption === undefined
                        ? undefined
                        : environmentKind,
                    baseBranch:
                      environmentOption !== undefined &&
                      environmentKind === "project-default"
                        ? null
                        : baseBranch,
                    machineId:
                      environmentOption !== undefined &&
                      environmentKind === "project-default"
                        ? null
                        : machine === undefined
                          ? undefined
                          : await resolveMachineId(domain, machine),
                    instructions: input.options.instructions,
                  }),
                ),
              );
              return input.options.json
                ? JSON.stringify(result)
                : `Пресет обновлён: ${result.preset.name}  ${result.preset.id}`;
            });
          },
        }),
        "preset delete": cliCommand({
          summary: "Удалить пресет запуска",
          positionals: [
            {
              name: "name-or-id",
              description: "Название пресета (без учёта регистра) или его ULID",
              required: true,
            },
          ],
          options: { json: JSON_OPTION },
          run(input) {
            return guard(async () => {
              const preset = resolvePreset(
                await listPresets(domain),
                input.positionals["name-or-id"],
              );
              const result = tasksRpcContract.deletePreset.output.parse(
                await domain.deletePreset(
                  tasksRpcContract.deletePreset.input.parse({
                    presetId: preset.id,
                  }),
                ),
              );
              return input.options.json
                ? JSON.stringify({ ...result, preset })
                : `Пресет удалён: ${preset.name}`;
            });
          },
        }),

        dispatch: cliCommand({
          summary: "Назначить задачу новому чату агента",
          aliases: ["delegate"],
          suggestFor: ["start", "run", "spawn"],
          positionals: [KEY_POSITIONAL],
          options: {
            preset: {
              type: "string",
              required: true,
              placeholder: "name-or-id",
              description:
                "Название или идентификатор пресета; список доступен через bb tasks preset list",
            },
            instructions: {
              type: "string",
              placeholder: "text",
              aliases: ["extra-instructions"],
              description: "Дополнительные инструкции только для этого запуска",
            },
            json: JSON_OPTION,
          },
          run(input) {
            return guard(async () => {
              const task = await resolveTask(
                domain,
                input.positionals["key-or-id"],
              );
              const preset = resolvePreset(
                await listPresets(domain),
                input.options.preset,
              );
              const result = delegationRpcContract.delegate.output.parse(
                await delegationHandlers(bb, store).delegate(
                  delegationRpcContract.delegate.input.parse({
                    taskId: task.id,
                    presetId: preset.id,
                    extraInstructions: input.options.instructions,
                  }),
                ),
              );
              return input.options.json
                ? JSON.stringify({ task, preset, ...result })
                : result.threadId;
            });
          },
        }),

        attach: cliCommand({
          summary: "Прикрепить существующий чат агента к задаче",
          positionals: [KEY_POSITIONAL],
          options: {
            thread: {
              type: "string",
              placeholder: "thread-id",
              aliases: ["thread-id"],
              description:
                "Чат для прикрепления; по умолчанию BB_THREAD_ID или вызвавший чат",
            },
            json: JSON_OPTION,
          },
          run(input, ctx) {
            return guard(async () => {
              const task = await resolveTask(
                domain,
                input.positionals["key-or-id"],
              );
              const threadId = resolveInvokingThreadId(
                input.options.thread,
                ctx,
              );
              const result =
                delegationRpcContract.taskThreadsAttach.output.parse(
                  await delegationHandlers(bb, store).taskThreadsAttach(
                    delegationRpcContract.taskThreadsAttach.input.parse({
                      taskId: task.id,
                      threadId,
                    }),
                  ),
                );
              return input.options.json
                ? JSON.stringify({ task, ...result })
                : `Чат ${result.threadId} прикреплён к ${task.key}`;
            });
          },
        }),

        detach: cliCommand({
          summary: "Открепить чат агента от задачи",
          positionals: [KEY_POSITIONAL],
          options: {
            thread: {
              type: "string",
              placeholder: "thread-id",
              aliases: ["thread-id"],
              description:
                "Чат для открепления; по умолчанию BB_THREAD_ID или вызвавший чат",
            },
            json: JSON_OPTION,
          },
          run(input, ctx) {
            return guard(async () => {
              const task = await resolveTask(
                domain,
                input.positionals["key-or-id"],
              );
              const threadId = resolveInvokingThreadId(
                input.options.thread,
                ctx,
              );
              const result =
                delegationRpcContract.taskThreadsDetach.output.parse(
                  await delegationHandlers(bb, store).taskThreadsDetach(
                    delegationRpcContract.taskThreadsDetach.input.parse({
                      taskId: task.id,
                      threadId,
                    }),
                  ),
                );
              return input.options.json
                ? JSON.stringify({ task, ...result })
                : `Чат ${result.threadId} откреплён от ${task.key}`;
            });
          },
        }),

        threads: cliCommand({
          summary: "Показать чаты агентов, прикреплённые к задаче",
          positionals: [KEY_POSITIONAL],
          options: { json: JSON_OPTION },
          run(input) {
            return guard(async () => {
              const task = await resolveTask(
                domain,
                input.positionals["key-or-id"],
              );
              const result = tasksRpcContract.listTaskThreads.output.parse(
                await domain.listTaskThreads(
                  tasksRpcContract.listTaskThreads.input.parse({
                    taskId: task.id,
                  }),
                ),
              );
              return input.options.json
                ? JSON.stringify({ task, taskThreads: result.taskThreads })
                : table(
                    ["ЧАТ", "СТАТУС", "ПРЕСЕТ", "НАЗВАНИЕ"],
                    result.taskThreads.map((thread) => [
                      thread.threadId,
                      thread.liveStatus,
                      thread.presetName,
                      thread.title,
                    ]),
                    "Прикреплённых чатов нет.",
                  );
            });
          },
        }),

        "seed-demo": cliCommand({
          summary:
            "Создать примеры папок, проектов, меток, задач и комментариев",
          options: {
            yes: {
              type: "boolean",
              description: "Подтвердить запись примеров в это рабочее пространство",
            },
            json: JSON_OPTION,
          },
          run(input, ctx) {
            return guard(async () => {
              if (!input.options.yes) {
                throw new CliError(
                  "seed-demo создаёт примерные данные; повторите команду с --yes",
                  { code: "confirmation_required" },
                );
              }
              const result = await seedDemo(domain, ctx.projectId);
              return input.options.json
                ? JSON.stringify(result)
                : detail([
                    ["Папки", result.foldersCreated],
                    ["Проекты", result.projectsCreated],
                    ["Метки", result.labelsCreated],
                    ["Задачи", result.tasksCreated],
                    ["Комментарии", result.commentsCreated],
                    ["Проект BB", result.linkedBbProjectId ?? "-"],
                  ]);
            });
          },
        }),
      },
    }),
  );
}
