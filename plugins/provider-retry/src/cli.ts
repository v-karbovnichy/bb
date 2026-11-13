import { readRetryDiagnostic } from "./diagnostics.js";
import {
  PluginCliError,
  cliCommand,
  defineCli,
  type BbPluginApi,
  type PluginCliContext,
  type PluginCliResult,
} from "@get-bb/plugin-sdk";
import {
  findQueuedRetry,
  listQueuedRetries,
  type QueuedRetry,
} from "./queued-retries.js";

const JSON_OPTION = {
  type: "boolean",
  description: "Вывести JSON для машинной обработки",
} as const;

const THREAD_ID_POSITIONAL = {
  name: "thread-id",
  description: "Чат, для которого нужно обработать ожидающую повторную попытку; по умолчанию текущий чат",
} as const;

function textQueuedRetry(queued: QueuedRetry): string {
  const retry =
    queued.sendAt === null
      ? "ожидает"
      : `повторная попытка ${new Date(queued.sendAt).toISOString()}`;
  return `${queued.threadId}\t${queued.id}\t${retry}`;
}

function requiredThreadId(
  requested: string | undefined,
  context: PluginCliContext,
  command: "cancel" | "retry" | "explain",
): string {
  const threadId = requested ?? context.threadId;
  if (threadId === undefined) {
    throw new PluginCliError(
      `Требуется ID чата: bb provider-retry ${command} <thread-id>`,
      { code: "missing_thread_id", exitCode: 2 },
    );
  }
  return threadId;
}

async function act(
  bb: BbPluginApi,
  threadId: string,
  json: boolean,
  command: "cancel" | "retry",
): Promise<PluginCliResult> {
  const queued = await findQueuedRetry(bb, threadId);
  if (queued === null) {
    throw new PluginCliError(
      `Для чата ${threadId} нет ожидающей повторной попытки провайдера.`,
      {
        code: "no_pending_retry",
        hint: "Запустите `bb provider-retry status`, чтобы увидеть чаты с ожидающей повторной попыткой.",
      },
    );
  }
  if (command === "cancel") {
    await bb.sdk.threads.queuedMessages.delete({
      threadId: queued.threadId,
      queuedMessageId: queued.id,
    });
  } else {
    await bb.sdk.threads.queuedMessages.send({
      threadId: queued.threadId,
      queuedMessageId: queued.id,
      mode: "auto",
    });
  }
  if (json) {
    return {
      exitCode: 0,
      stdout: `${JSON.stringify({ ok: true, threadId, queuedMessageId: queued.id }, null, 2)}\n`,
    };
  }
  return {
    exitCode: 0,
    stdout:
      command === "cancel"
        ? `Повторная попытка провайдера для чата ${threadId} отменена.\n`
        : `Повторная попытка для чата ${threadId} запущена.\n`,
  };
}

export function registerProviderRetryCli(bb: BbPluginApi): void {
  bb.cli.register(
    defineCli({
      name: "provider-retry",
      summary: "Управлять ожидающими автоматическими повторными попытками провайдеров",
      description:
        "Ожидающая повторная попытка хранится в обычной постоянной очереди: cancel удаляет её, а retry отправляет сразу, не дожидаясь запланированного времени.",
      usageErrorExitCode: 2,
      commands: {
        status: cliCommand({
          summary: "Показать ожидающие автоматические повторные попытки провайдеров",
          positionals: [
            {
              name: "thread-id",
              description:
                "Чат для фильтрации списка; по умолчанию текущий чат, а вне чата показываются все",
            },
          ],
          options: { json: JSON_OPTION },
          async run(input, context) {
            const threadId =
              input.positionals["thread-id"] ?? context.threadId ?? null;
            const queued = await listQueuedRetries(
              bb,
              threadId === null ? undefined : threadId,
            );
            if (input.options.json) {
              return {
                exitCode: 0,
                stdout: `${JSON.stringify({ retries: queued }, null, 2)}\n`,
              };
            }
            return {
              exitCode: 0,
              stdout:
                queued.length === 0
                  ? "Ожидающих повторных попыток провайдеров нет.\n"
                  : `${queued.map(textQueuedRetry).join("\n")}\n`,
            };
          },
        }),
        explain: cliCommand({
          summary: "Объяснить последнее решение об автоматической повторной попытке для чата",
          positionals: [THREAD_ID_POSITIONAL],
          options: { json: JSON_OPTION },
          async run(input, context) {
            const threadId = requiredThreadId(
              input.positionals["thread-id"],
              context,
              "explain",
            );
            const diagnostic = await readRetryDiagnostic(bb, threadId);
            if (input.options.json)
              return {
                exitCode: 0,
                stdout: `${JSON.stringify({ threadId, diagnostic }, null, 2)}\n`,
              };
            if (diagnostic === null)
              return {
                exitCode: 0,
                stdout: `Для чата ${threadId} нет записанного решения об автоматической повторной попытке.\n`,
              };
            const { decision, availability, consent } = diagnostic;
            return {
              exitCode: 0,
              stdout: `${threadId}: ${decision.kind === "retry" ? `Запланировано на ${new Date(decision.sendAt).toISOString()}` : "Пропущено"}: ${decision.reason}${availability.kind === "unavailable" ? ` (${availability.reason})` : ""}${consent?.answer.kind === "decline" ? ` (${consent.pluginId}: ${consent.answer.reason})` : ""}.\n`,
            };
          },
        }),
        cancel: cliCommand({
          summary: "Отменить ожидающую автоматическую повторную попытку провайдера",
          positionals: [THREAD_ID_POSITIONAL],
          options: { json: JSON_OPTION },
          run: (input, context) =>
            act(
              bb,
              requiredThreadId(
                input.positionals["thread-id"],
                context,
                "cancel",
              ),
              input.options.json,
              "cancel",
            ),
        }),
        retry: cliCommand({
          summary: "Отправить ожидающую повторную попытку провайдера сейчас",
          positionals: [THREAD_ID_POSITIONAL],
          options: { json: JSON_OPTION },
          run: (input, context) =>
            act(
              bb,
              requiredThreadId(
                input.positionals["thread-id"],
                context,
                "retry",
              ),
              input.options.json,
              "retry",
            ),
        }),
      },
    }),
  );
}
