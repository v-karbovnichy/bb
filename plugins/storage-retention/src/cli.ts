import type { Storage } from "./storage.js";
import {
  cliCommand,
  defineCli,
  type BbPluginApi,
  type PluginCliResult,
} from "@get-bb/plugin-sdk";
import { policySchema } from "./contract.js";
import type { Service } from "./service.js";

const MACHINE = { type: "string", description: "ID машины" } as const;
const YES = {
  type: "boolean",
  description: "Подтвердить безвозвратное действие",
} as const;
function required(value: string | undefined, name: string) {
  if (!value) throw new Error(`Укажите --${name}.`);
  return value;
}
function booleanSetting(
  value: string | undefined,
  fallback: boolean,
  flag: string,
) {
  if (value === undefined) return fallback;
  if (value !== "true" && value !== "false")
    throw new Error(`Для --${flag} укажите true или false.`);
  return value === "true";
}
function days(value: string | undefined, fallback: number | null) {
  if (value === undefined) return fallback;
  if (value === "never") return null;
  if (!/^\d+$/.test(value))
    throw new Error("Укажите число дней (1–3650) или never.");
  return Number(value);
}
async function output(work: () => Promise<unknown>): Promise<PluginCliResult> {
  try {
    return {
      exitCode: 0,
      stdout: JSON.stringify(await work(), null, 2) + "\n",
    };
  } catch (error) {
    return {
      exitCode: 1,
      stderr: (error instanceof Error ? error.message : String(error)) + "\n",
    };
  }
}
export function registerCli(
  bb: BbPluginApi,
  service: Service,
  storage: Storage,
) {
  bb.cli.register(
    defineCli({
      name: "storage",
      summary: "Проверка хранилища и управление хранением чатов (вывод JSON)",
      root: cliCommand({
        summary: "Показать команды хранилища",
        run: (input) => ({ exitCode: 0, stdout: input.help }),
      }),
      commands: {
        cleanup: cliCommand({
          summary: "Начать фоновую очистку; ход выполнения смотрите в storage usage",
          options: {
            machine: MACHINE,
            kind: {
              type: "string",
              description:
                "orphans, development, worktrees, or externalWorktrees",
            },
            yes: YES,
          },
          run: ({ options }) =>
            output(async () => {
              if (!options.yes)
                throw new Error("Для подтверждения очистки укажите --yes.");
              const kind = options.kind;
              if (
                kind !== "orphans" &&
                kind !== "development" &&
                kind !== "worktrees" &&
                kind !== "externalWorktrees"
              )
                throw new Error(
                  "Для --kind укажите orphans, development, worktrees или externalWorktrees.",
                );
              await storage.startCleanup({
                hostId: required(options.machine, "machine"),
                kind,
              });
              return { started: true };
            }),
        }),
        retention: cliCommand({
          summary:
            "Показать политику и последнюю проверку, просмотреть сроки или сохранить с --save --yes",
          options: {
            "archive-after": {
              type: "string",
              description: "Дней без активности до архивирования или never",
            },
            "delete-after": {
              type: "string",
              description: "Дней в архиве до удаления или never",
            },
            "delete-storage-on-archive": {
              type: "string",
              description: "Удалять файлы чата при архивировании: true или false",
            },
            "delete-dev-data-on-checkout-removal": {
              type: "string",
              description:
                "Удалять данные разработки без рабочего дерева: true или false",
            },
            save: {
              type: "boolean",
              description: "Сохранить указанные настройки",
            },
            yes: YES,
          },
          run: (input) =>
            output(async () => {
              const state = await service.state();
              const cleanup = input.options["delete-storage-on-archive"];
              const devCleanup =
                input.options["delete-dev-data-on-checkout-removal"];
              const policy = policySchema.parse({
                deleteStorageOnArchive: booleanSetting(
                  cleanup,
                  state.policy.deleteStorageOnArchive,
                  "delete-storage-on-archive",
                ),
                deleteDevDataOnCheckoutRemoval: booleanSetting(
                  devCleanup,
                  state.policy.deleteDevDataOnCheckoutRemoval,
                  "delete-dev-data-on-checkout-removal",
                ),
                archiveAfterDays: days(
                  input.options["archive-after"],
                  state.policy.archiveAfterDays,
                ),
                deleteAfterDays: days(
                  input.options["delete-after"],
                  state.policy.deleteAfterDays,
                ),
              });
              if (input.options.save) {
                if (!input.options.yes)
                  throw new Error(
                    "Сначала просмотрите политику, затем укажите --save --yes для подтверждения.",
                  );
                return service.configure(policy);
              }
              if (
                input.options["archive-after"] !== undefined ||
                input.options["delete-after"] !== undefined ||
                cleanup !== undefined ||
                devCleanup !== undefined
              )
                return { policy, preview: await service.preview(policy) };
              return state;
            }),
        }),
        usage: cliCommand({
          summary:
            "Показать сохранённые данные об использовании машины; --rescan начнёт фоновую проверку, повторите команду для результатов",
          options: {
            machine: MACHINE,
            rescan: {
              type: "boolean",
              description:
                "Начать проверку --machine или всех машин в сети",
            },
          },
          run: (input) =>
            output(async () => {
              if (input.options.rescan)
                return input.options.machine
                  ? storage.scanHost({ hostId: input.options.machine })
                  : storage.scanAll();
              return input.options.machine
                ? storage.host({
                    hostId: input.options.machine,
                  })
                : storage.hosts();
            }),
        }),
        "remove-orphans": cliCommand({
          summary: "Удалить осиротевшие файлы, найденные при последней проверке",
          options: { machine: MACHINE, yes: YES },
          run: (input) =>
            output(async () => {
              if (!input.options.yes)
                throw new Error(
                  "Для безвозвратного удаления осиротевших файлов укажите --yes.",
                );
              return storage.removeOrphans({
                hostId: required(input.options.machine, "machine"),
              });
            }),
        }),
        "clear-large-files": cliCommand({
          summary:
            "Удалить файлы размером от 10 МБ в архивных чатах на --machine или на всех проверенных машинах в сети",
          options: { machine: MACHINE, yes: YES },
          run: (input) =>
            output(async () => {
              if (!input.options.yes)
                throw new Error(
                  "Для безвозвратного удаления больших файлов архивных чатов укажите --yes.",
                );
              return storage.clearLargeFiles({
                hostId: input.options.machine ?? null,
              });
            }),
        }),
        "retry-worktree-cleanup": cliCommand({
          summary: "Повторить очистку оставшихся рабочих деревьев",
          options: { machine: MACHINE },
          run: (input) =>
            output(async () => {
              return storage.retryWorktreeCleanup({
                hostId: required(input.options.machine, "machine"),
              });
            }),
        }),
        "remove-external-worktrees": cliCommand({
          summary:
            "Удалить рабочие деревья git в репозиториях проектов, созданные вне BB; ветки сохранятся, а деревья с незакоммиченными изменениями, блокировкой или коммитами вне веток будут пропущены",
          options: {
            machine: MACHINE,
            path: {
              type: "string",
              description:
                "Удалить только это рабочее дерево из последней проверки (по умолчанию — все деревья, созданные вне BB)",
            },
            force: {
              type: "boolean",
              description:
                "С --path также удалить заблокированное дерево или дерево с незакоммиченными изменениями либо коммитами вне веток, потеряв эти данные",
            },
            yes: YES,
          },
          run: (input) =>
            output(async () => {
              if (!input.options.yes)
                throw new Error(
                  "Для безвозвратного удаления этих рабочих деревьев укажите --yes.",
                );
              const hostId = required(input.options.machine, "machine");
              if (input.options.path === undefined) {
                if (input.options.force)
                  throw new Error("--force requires --path.");
                return storage.removeExternalWorktrees({ hostId, paths: null });
              }
              return storage.removeExternalWorktrees({
                hostId,
                paths: [input.options.path],
                force: input.options.force === true,
              });
            }),
        }),
        "clear-thread": cliCommand({
          summary: "Очистить папку файлов остановленного чата",
          options: {
            thread: { type: "string", description: "ID чата" },
            yes: YES,
          },
          run: (input) =>
            output(async () => {
              if (!input.options.yes)
                throw new Error(
                  "Для безвозвратного удаления файлов чата укажите --yes.",
                );
              return storage.clearThread({
                threadId: required(input.options.thread, "thread"),
              });
            }),
        }),
        "clear-archived-files": cliCommand({
          summary:
            "Удалить все файлы архивных, остановленных и незакреплённых чатов на машине",
          options: { machine: MACHINE, yes: YES },
          run: (input) =>
            output(async () => {
              if (!input.options.yes)
                throw new Error(
                  "Для безвозвратного удаления файлов архивных чатов укажите --yes.",
                );
              return storage.clearArchivedFiles({
                hostId: required(input.options.machine, "machine"),
              });
            }),
        }),
        "remove-dev-instances": cliCommand({
          summary:
            "Удалить экземпляры ~/.bb-dev без исходного рабочего дерева, предварительно остановив работающие серверы",
          options: {
            machine: MACHINE,
            instance: {
              type: "string",
              description:
                "Удалить только эту запись ~/.bb-dev, предварительно остановив её сервер разработки (по умолчанию — все экземпляры без рабочего дерева)",
            },
            yes: YES,
          },
          run: (input) =>
            output(async () => {
              if (!input.options.yes)
                throw new Error(
                  "Для остановки серверов и безвозвратного удаления данных экземпляров разработки укажите --yes.",
                );
              return storage.removeDevInstances({
                hostId: required(input.options.machine, "machine"),
                ...(input.options.instance === undefined
                  ? { names: null }
                  : { names: [input.options.instance], stopRunning: true }),
              });
            }),
        }),
      },
    }),
  );
}
