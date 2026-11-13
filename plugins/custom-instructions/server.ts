import {
  PluginCliError,
  cliCommand,
  defineCli,
  type BbPluginApi,
} from "@get-bb/plugin-sdk";
import { z } from "zod";

export const MAX_CUSTOM_INSTRUCTIONS_LENGTH = 4096;
const STORAGE_KEY = "customInstructions";
const customInstructionsSchema = z
  .string()
  .max(
    MAX_CUSTOM_INSTRUCTIONS_LENGTH,
    `Пользовательские инструкции не могут превышать ${MAX_CUSTOM_INSTRUCTIONS_LENGTH} символов`,
  );

const JSON_OPTION = {
  type: "boolean",
  description: "Вывести JSON для машинной обработки",
} as const;

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    instructions: {
      type: "string",
      label: "Пользовательские инструкции",
      description:
        "Добавьте инструкции и контекст для задач агентов на этом сервере bb.",
      experimental_multiline: true,
      experimental_schema: customInstructionsSchema,
      default: "",
    },
  });

  let current = await settings.get();
  const legacy = await bb.storage.kv.get<string>(STORAGE_KEY);
  if (legacy !== undefined) {
    if (current.instructions.length === 0 && legacy.length > 0) {
      current = await settings.experimental_set({ instructions: legacy });
    }
    await bb.storage.kv.delete(STORAGE_KEY);
  }
  let customInstructions = current.instructions;

  settings.onChange((next) => {
    customInstructions = next.instructions;
  });

  bb.agents.contributeInstructions(() =>
    customInstructions.trim().length > 0 ? customInstructions : null,
  );

  bb.cli.register(
    defineCli({
      name: "instructions",
      summary: "Просмотреть и изменить пользовательские инструкции для агентов",
      description:
        "Этот текст добавляется к инструкциям, которые bb уже передаёт каждому агенту на этом сервере.",
      commands: {
        get: cliCommand({
          summary: "Вывести текущие пользовательские инструкции",
          options: { json: JSON_OPTION },
          run: (input) => ({
            exitCode: 0,
            stdout: input.options.json
              ? JSON.stringify({ instructions: customInstructions })
              : customInstructions,
          }),
        }),
        set: cliCommand({
          summary: "Заменить пользовательские инструкции",
          positionals: [
            {
              name: "text",
              description: `Новые инструкции, соединённые одиночными пробелами; не более ${MAX_CUSTOM_INSTRUCTIONS_LENGTH} символов`,
              required: true,
              variadic: true,
            },
          ],
          options: { json: JSON_OPTION },
          async run(input) {
            const parsed = customInstructionsSchema.safeParse(
              input.positionals.text.join(" "),
            );
            if (!parsed.success) {
              throw new PluginCliError(
                parsed.error.issues[0]?.message ?? "Недопустимые инструкции",
                { code: "invalid_instructions" },
              );
            }
            const next = await settings.experimental_set({
              instructions: parsed.data,
            });
            customInstructions = next.instructions;
            return {
              exitCode: 0,
              stdout: input.options.json
                ? JSON.stringify({ instructions: customInstructions })
                : "Пользовательские инструкции обновлены",
            };
          },
        }),
        clear: cliCommand({
          summary: "Очистить пользовательские инструкции",
          options: { json: JSON_OPTION },
          async run(input) {
            const next = await settings.experimental_set({ instructions: "" });
            customInstructions = next.instructions;
            return {
              exitCode: 0,
              stdout: input.options.json
                ? JSON.stringify({ instructions: "" })
                : "Пользовательские инструкции очищены",
            };
          },
        }),
      },
    }),
  );
}
