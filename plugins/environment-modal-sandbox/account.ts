import {
  buildOutput,
  runOutput,
  execInput,
  execOutput,
  sandboxInput,
  type DebugSandbox,
} from "./debug-sandbox.js";
import {
  defineRpcContract,
  PluginCliError,
  cliCommand,
  defineCli,
  type BbPluginApi,
  type PluginCliContext,
  type PluginCliResult,
} from "@get-bb/plugin-sdk";
import path from "node:path";
import { z } from "zod";
import { dockerfileSchema, type ImageDefinition } from "./image-definition.js";
import { errorMessage } from "./error-message.js";
import {
  modalLaunchOptionsSchema,
  type ModalLaunchOptionsStore,
} from "./launch-options.js";

const machineInput = z.object({ hostId: z.string().min(1) }).strict();
const machineOutput = z.object({
  summary: z.string(),
  values: z.object({
    state: z.enum(["running", "suspended", "missing"]),
    expiresAt: z.number().nullable(),
    snapshotImageId: z.string().nullable(),
  }),
});

const definitionSchema = z.object({
  dockerfile: z.string(),
  customized: z.boolean(),
});
export const modalRpcContract = defineRpcContract({
  "machine.inspect": { input: machineInput, output: machineOutput },
  "image.build": { input: z.object({}).strict(), output: buildOutput },
  "sandbox.run": { input: z.object({}).strict(), output: runOutput },
  "sandbox.exec": { input: execInput, output: execOutput },
  "sandbox.stop": { input: sandboxInput, output: sandboxInput },
  "image.definition": {
    input: z.object({}).strict(),
    output: definitionSchema,
  },
  "image.set": {
    input: z.object({ dockerfile: dockerfileSchema }).strict(),
    output: definitionSchema,
  },
  "image.reset": { input: z.object({}).strict(), output: definitionSchema },
  "launch.options": {
    input: z.object({}).strict(),
    output: modalLaunchOptionsSchema,
  },
  "launch.options.set": {
    input: modalLaunchOptionsSchema,
    output: modalLaunchOptionsSchema,
  },
  "account.inspect": {
    input: z.object({}).strict(),
    output: z.object({ available: z.boolean(), message: z.string() }),
  },
});

export function registerRpcAndCli(
  bb: BbPluginApi,
  image: ImageDefinition,
  launchOptions: ModalLaunchOptionsStore,
  inspect: () => Promise<{ available: boolean; message: string }>,
  debug: DebugSandbox,
  inspectMachine: (
    input: z.infer<typeof machineInput>,
  ) => Promise<z.infer<typeof machineOutput>>,
) {
  bb.rpc.register(modalRpcContract, {
    "machine.inspect": inspectMachine,
    "image.build": () => debug.build(),
    "sandbox.run": () => debug.run(),
    "sandbox.exec": (input) => debug.exec(input),
    "sandbox.stop": debug.stop,
    "account.inspect": inspect,
    "image.definition": image.get,
    "image.set": ({ dockerfile }) => image.set(dockerfile),
    "image.reset": image.reset,
    "launch.options": launchOptions.get,
    "launch.options.set": launchOptions.set,
  });
  async function readDockerfile(file: string, context: PluginCliContext) {
    let hostId: string | undefined;
    if (context.threadId) {
      const thread = await bb.sdk.threads.get({ threadId: context.threadId });
      if (!thread.environmentId)
        throw new Error("У текущего чата нет рабочего пространства на машине");
      const environment = await bb.sdk.environments.get({
        environmentId: thread.environmentId,
      });
      if (!environment.hostId)
        throw new Error("У текущего чата нет рабочего пространства на машине");
      hostId = environment.hostId;
    }
    if (!path.isAbsolute(file) && !context.cwd)
      throw new Error("Для относительного пути --file требуется рабочий каталог CLI");
    const result = await bb.sdk.files.read({
      hostId,
      path: path.resolve(context.cwd ?? "/", file),
      signal: context.signal,
    });
    if (result.contentEncoding !== "utf8")
      throw new Error("Dockerfile должен быть текстом в кодировке UTF-8");
    return dockerfileSchema.parse(result.content);
  }
  async function guarded(
    run: () => Promise<PluginCliResult>,
  ): Promise<PluginCliResult> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof PluginCliError) throw error;
      throw new PluginCliError(errorMessage(error));
    }
  }
  const jsonOption = {
    json: {
      type: "boolean",
      description: "Вывести исходный результат в JSON вместо обычного текста",
    },
  } as const;
  bb.cli.register(
    defineCli({
      name: "modal",
      summary: "Настройка, сборка и отладка образов Modal",
      description:
        "Отладочные песочницы временные: они запускают сохранённый образ на 30 минут и не содержат секретов машины.",
      commands: {
        "machine inspect": cliCommand({
          summary: "Показать вычислительные ресурсы Modal и последний сохранённый снимок",
          positionals: [
            {
              name: "host-id",
              description: "Хост BB, чью машину Modal нужно проверить",
              required: true,
            },
          ],
          options: jsonOption,
          run(input) {
            return guarded(async () => {
              const result = await inspectMachine(
                machineInput.parse({ hostId: input.positionals["host-id"] }),
              );
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? JSON.stringify(result)
                  : result.summary,
              };
            });
          },
        }),
        "image build": cliCommand({
          summary: "Собрать или повторно использовать сохранённый образ",
          options: jsonOption,
          run(input, context) {
            return guarded(async () => {
              const result = await debug.build(context.signal);
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? JSON.stringify(result)
                  : `${result.logs}${result.imageId}`,
              };
            });
          },
        }),
        "sandbox run": cliCommand({
          summary: "Запустить сохранённый образ в отладочной песочнице на 30 минут",
          options: jsonOption,
          run(input, context) {
            return guarded(async () => {
              const result = await debug.run(context.signal);
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? JSON.stringify(result)
                  : result.sandboxId,
                stderr: input.options.json ? "" : result.logs,
              };
            });
          },
        }),
        "sandbox exec": cliCommand({
          summary: "Выполнить команду в отладочной песочнице",
          description:
            "Всё после `--` считается командой и не разбирается как параметры.",
          positionals: [
            {
              name: "sandbox-id",
              description: "Отладочная песочница, запущенная командой bb modal sandbox run",
              required: true,
            },
          ],
          passthrough: true,
          options: jsonOption,
          run(input, context) {
            return guarded(async () => {
              if (input.passthrough.length === 0) {
                throw new PluginCliError(
                  "Для bb modal sandbox exec укажите команду после --",
                  {
                    code: "missing_command",
                    hint: "Пример: bb modal sandbox exec <sandbox-id> -- bash -lc 'echo hi'.",
                  },
                );
              }
              const result = await debug.exec(
                execInput.parse({
                  sandboxId: input.positionals["sandbox-id"],
                  command: input.passthrough,
                }),
                context.signal,
              );
              return {
                exitCode: result.exitCode,
                stdout: input.options.json
                  ? JSON.stringify(result)
                  : result.stdout,
                stderr: input.options.json ? "" : result.stderr,
              };
            });
          },
        }),
        "sandbox stop": cliCommand({
          summary: "Остановить отладочную песочницу",
          positionals: [
            {
              name: "sandbox-id",
              description: "Отладочная песочница, запущенная командой bb modal sandbox run",
              required: true,
            },
          ],
          options: jsonOption,
          run(input) {
            return guarded(async () => {
              const result = await debug.stop(
                sandboxInput.parse({
                  sandboxId: input.positionals["sandbox-id"],
                }),
              );
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? JSON.stringify(result)
                  : `Остановлена песочница ${result.sandboxId}`,
              };
            });
          },
        }),
        "image show": cliCommand({
          summary: "Показать Dockerfile для новых машин",
          options: jsonOption,
          run(input) {
            return guarded(async () => {
              const result = await image.get();
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? JSON.stringify(result)
                  : result.dockerfile,
              };
            });
          },
        }),
        "image set": cliCommand({
          summary: "Сохранить Dockerfile для будущих машин",
          options: {
            file: {
              type: "string",
              required: true,
              placeholder: "PATH",
              aliases: ["dockerfile", "path"],
              description:
                "Dockerfile для сохранения; относительный путь определяется от рабочего каталога CLI на хосте чата",
            },
            ...jsonOption,
          },
          run(input, context) {
            return guarded(async () => {
              const result = await image.set(
                await readDockerfile(input.options.file, context),
              );
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? JSON.stringify(result)
                  : "Dockerfile сохранён для будущих машин.",
              };
            });
          },
        }),
        "image reset": cliCommand({
          summary: "Восстановить встроенный Dockerfile",
          options: jsonOption,
          run(input) {
            return guarded(async () => {
              const result = await image.reset();
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? JSON.stringify(result)
                  : "Встроенный Dockerfile восстановлен для будущих машин.",
              };
            });
          },
        }),
        "account inspect": cliCommand({
          summary: "Проверить настроенную учётную запись Modal",
          options: jsonOption,
          run(input) {
            return guarded(async () => {
              const result = await inspect();
              return {
                exitCode: result.available ? 0 : 1,
                stdout: input.options.json
                  ? JSON.stringify(result)
                  : result.message,
              };
            });
          },
        }),
      },
    }),
  );
}
