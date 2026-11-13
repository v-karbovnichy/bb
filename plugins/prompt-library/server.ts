import {
  cliCommand,
  defineCli,
  PluginCliError,
  type BbPluginApi,
} from "@get-bb/plugin-sdk";
import type { ComposerDraft } from "@get-bb/plugin-sdk";
import {
  promptLibraryRpcContract,
  promptTitleSchema,
  type PromptRow,
  type SearchPromptsInput,
} from "./contract.js";
import { createHistoryCache, type HistoryCandidate } from "./history-cache.js";
import {
  buildSnippet,
  createSearchIndex,
  matchPositions,
  queryTerms,
} from "./ranking.js";
import {
  createStarredPromptStore,
  STARRED_PROMPT_MIGRATIONS,
  type StarredPrompt,
} from "./store.js";

const STARRED_RESULT_LIMIT = 20;
const RECENT_RESULT_LIMIT = 30;
const INDEX_CHUNK_SIZE = 500;

type SearchItem =
  | { kind: "starred"; prompt: StarredPrompt }
  | { kind: "recent"; candidate: HistoryCandidate };

const JSON_OPTION = {
  type: "boolean",
  description: "Вывести JSON для машинной обработки",
} as const;

export default function promptLibraryPlugin(bb: BbPluginApi): void {
  const db = bb.storage.database();
  bb.storage.migrate(db, STARRED_PROMPT_MIGRATIONS);
  const store = createStarredPromptStore(db);

  const controller = new AbortController();
  const index = createSearchIndex<SearchItem>();
  const historyCache = createHistoryCache(
    (args) => bb.sdk.experimental_promptHistory.list(args),
    async (entries) => {
      for (
        let offset = 0;
        offset < entries.length;
        offset += INDEX_CHUNK_SIZE
      ) {
        controller.signal.throwIfAborted();
        for (const candidate of entries.slice(
          offset,
          offset + INDEX_CHUNK_SIZE,
        )) {
          index.add({
            item: { kind: "recent", candidate },
            text: candidate.prompt.text,
            time: candidate.createdAt,
          });
        }
        await new Promise((resolve) => setImmediate(resolve));
      }
    },
    controller.signal,
  );
  let refresh: Promise<void> | null = null;
  let refreshedAt = -Infinity;
  let historyError: string | null = null;
  let names = new Map<string, string>();
  let namesRefreshedAt = -Infinity;
  let namesPending: Promise<void> | null = null;

  function refreshNames(): Promise<void> {
    if (namesPending !== null) return namesPending;
    if (Date.now() - namesRefreshedAt < 60_000) return Promise.resolve();
    namesPending = bb.sdk.projects
      .list({ includePersonal: true, signal: controller.signal })
      .then((projects) => {
        names = new Map(projects.map((project) => [project.id, project.name]));
        namesRefreshedAt = Date.now();
      })
      .finally(() => {
        namesPending = null;
      });
    return namesPending;
  }

  function loadHistory(): Promise<void> {
    if (refresh !== null) return refresh;
    historyError = null;
    refresh = historyCache
      .refresh()
      .then(() => {
        refreshedAt = Date.now();
      })
      .catch((cause: unknown) => {
        historyError = cause instanceof Error ? cause.message : String(cause);
        throw cause;
      })
      .finally(() => {
        refresh = null;
      });
    return refresh;
  }

  const warmup = setImmediate(() => {
    if (refreshedAt === -Infinity && historyError === null)
      void loadHistory().catch(() => {});
    void refreshNames().catch(() => {});
  });
  bb.onDispose(async () => {
    clearImmediate(warmup);
    controller.abort();
    await Promise.allSettled([refresh, namesPending]);
  });

  function inScope(candidate: HistoryCandidate, input: SearchPromptsInput) {
    if (input.scope === "thread") return candidate.threadId === input.threadId;
    if (input.scope === "project") {
      return candidate.projectId === input.projectId;
    }
    return true;
  }

  function historySearchable(input: SearchPromptsInput): boolean {
    if (input.scope === "thread") return input.threadId !== null;
    if (input.scope === "project") return input.projectId !== null;
    return true;
  }

  function orderedItems(
    input: SearchPromptsInput,
    starredPrompts: readonly StarredPrompt[],
    history: readonly HistoryCandidate[],
  ): SearchItem[] {
    const searching = queryTerms(input.query).length > 0;
    const normalizedQuery = input.query.trim().toLowerCase();
    const exactTitle = (item: SearchItem) =>
      item.kind === "starred" &&
      item.prompt.title?.toLowerCase() === normalizedQuery;
    const items: SearchItem[] = searching
      ? index
          .search(
            input.query,
            starredPrompts.map((prompt) => ({
              item: { kind: "starred", prompt },
              text: `${prompt.prompt.text}\n${prompt.title ?? ""}`,
              time: prompt.lastUsedAt ?? prompt.createdAt,
            })),
            Date.now(),
            (item) =>
              item.kind === "starred" ||
              item.candidate.scope ===
                (input.composer === "new-thread" ? "project" : "thread"),
          )
          .sort(
            (left, right) =>
              Number(exactTitle(right.item)) - Number(exactTitle(left.item)),
          )
          .map((match) => match.item)
      : [
          ...starredPrompts.map((prompt): SearchItem => ({
            kind: "starred",
            prompt,
          })),
          ...history.map((candidate): SearchItem => ({
            kind: "recent",
            candidate,
          })),
        ];
    const seenTexts = new Set(
      searching ? starredPrompts.map((prompt) => prompt.prompt.text) : [],
    );
    const includeHistory = historySearchable(input);
    let starredCount = 0;
    let recentCount = 0;
    const ordered: SearchItem[] = [];
    for (const item of items) {
      if (item.kind === "starred") {
        if (starredCount === STARRED_RESULT_LIMIT) continue;
        starredCount += 1;
        ordered.push(item);
        continue;
      }
      const { candidate } = item;
      const text = candidate.prompt.text;
      if (!includeHistory || recentCount === RECENT_RESULT_LIMIT) continue;
      if (!inScope(candidate, input)) continue;
      if (text.trim().length === 0 || seenTexts.has(text)) continue;
      seenTexts.add(text);
      recentCount += 1;
      ordered.push(item);
    }
    return ordered;
  }

  function snippet(text: string, query: string) {
    return buildSnippet(text, matchPositions(text, query));
  }

  async function search(input: SearchPromptsInput) {
    const starredPrompts = store.list();
    const starredIdsByText = new Map(
      starredPrompts.map((prompt) => [prompt.prompt.text, prompt.id]),
    );
    const includeHistory = historySearchable(input);
    if (includeHistory) {
      if (
        input.refreshHistory &&
        (input.waitForHistory ||
          historyError !== null ||
          Date.now() - refreshedAt >= 2_000)
      ) {
        void loadHistory().catch(() => {});
      }
      if (input.waitForHistory) {
        if (refresh !== null) await refresh;
        if (historyCache.snapshot().length > 0) await refreshNames();
      } else {
        void refreshNames().catch(() => {});
      }
    }
    const history = includeHistory ? historyCache.snapshot() : [];
    const items = orderedItems(input, starredPrompts, history);
    const prompts = items.map((item): PromptRow => {
      if (item.kind === "starred") {
        const { prompt } = item;
        return {
          kind: "starred",
          id: prompt.id,
          title: prompt.title,
          titleSnippet:
            prompt.title === null ? null : snippet(prompt.title, input.query),
          prompt: prompt.prompt,
          snippet: snippet(prompt.prompt.text, input.query),
          createdAt: prompt.createdAt,
          lastUsedAt: prompt.lastUsedAt,
        };
      }
      const { candidate } = item;
      const text = candidate.prompt.text;
      return {
        kind: "recent",
        id: candidate.id,
        prompt: candidate.prompt,
        snippet: snippet(text, input.query),
        createdAt: candidate.createdAt,
        projectId: candidate.projectId,
        projectName: names.get(candidate.projectId) ?? null,
        threadId: candidate.threadId,
        starredId: starredIdsByText.get(text) ?? null,
      };
    });
    return {
      prompts,
      loading: includeHistory && refresh !== null,
      historyError: includeHistory ? historyError : null,
    };
  }

  function star(prompt: ComposerDraft, title: string | null): StarredPrompt {
    const starred = store.star(prompt, title, Date.now());
    if (starred === null) {
      throw new Error("Для добавления шаблона в избранное нужен текст.");
    }
    return starred;
  }

  function setTitle(id: string, title: string | null) {
    if (!store.setTitle(id, title)) {
      throw new PluginCliError(`Неизвестный шаблон в избранном: ${id}`, {
        code: "unknown_prompt",
        hint: "Выполните `bb prompts list`, чтобы увидеть ID избранных шаблонов.",
      });
    }
    return { id, title };
  }

  bb.rpc.register(promptLibraryRpcContract, {
    search,
    star: ({ prompt, title }) => ({
      id: star({ text: prompt.text, mentions: prompt.mentions }, title).id,
    }),
    setTitle: ({ id, title }) => setTitle(id, title),
    unstar: ({ id }) => ({ unstarred: store.unstar(id) }),
    markUsed({ id }) {
      store.markUsed(id, Date.now());
      return null;
    },
    recordInsertion() {
      bb.internal_DO_NOT_USE_recordPluginUse();
      return null;
    },
  });

  bb.cli.register(
    defineCli({
      name: "prompts",
      summary: "Поиск предыдущих запросов и управление избранными шаблонами",
      description:
        "Без запроса избранные шаблоны показываются перед недавними в меню «Шаблоны…» (Ctrl+R). Поиск учитывает названия и текст запросов; точные совпадения названий идут первыми. Затем результаты сортируются по началу текста, типу совпадения, избранному, типу поля ввода (новый чат или продолжение) и актуальности. Предыдущие запросы берутся из истории bb.",
      commands: {
        search: cliCommand({
          summary: "Поиск избранных и предыдущих запросов",
          positionals: [
            {
              name: "query",
              description:
                "Слова для поиска: точное совпадение, начало слова, одна опечатка, часть слова или сокращение. Не указывайте, чтобы показать недавние запросы",
              variadic: true,
            },
          ],
          options: {
            project: {
              type: "string",
              description: "Искать запросы этого проекта",
            },
            thread: {
              type: "string",
              description: "Искать запросы этого чата",
            },
            composer: {
              type: "enum",
              values: ["new-thread", "follow-up"],
              default: "follow-up",
              description:
                "Учитывать тип поля ввода: для нового чата выше запросы, начавшие чаты; для продолжения — ответы в чатах",
            },
            partial: {
              type: "boolean",
              description:
                "Сразу вернуть доступные результаты; JSON включает loading и historyError",
            },
            json: JSON_OPTION,
          },
          constraints: [
            { kind: "at-most-one", options: ["project", "thread"] },
          ],
          async run({ options, positionals }) {
            const result = await search({
              query: positionals.query.join(" "),
              scope:
                options.thread !== undefined
                  ? "thread"
                  : options.project !== undefined
                    ? "project"
                    : "global",
              projectId: options.project ?? null,
              threadId: options.thread ?? null,
              composer: options.composer,
              waitForHistory: !options.partial,
              refreshHistory: true,
            });
            if (options.json) {
              return { exitCode: 0, stdout: JSON.stringify(result) };
            }
            const lines = result.prompts.map((row) =>
              row.kind === "starred"
                ? `★ ${row.id}  ${row.title === null ? "" : `${row.title} — `}${row.snippet.text}`
                : `  ${new Date(row.createdAt).toISOString()}  ${row.snippet.text}`,
            );
            return {
              exitCode: 0,
              stdout: [
                lines.length > 0
                  ? lines.join("\n")
                  : result.loading
                    ? "Загрузка шаблонов…"
                    : "Шаблоны не найдены",
                ...(result.loading ? ["Поиск старых запросов…"] : []),
                ...(result.historyError === null
                  ? []
                  : [`История недоступна: ${result.historyError}`]),
              ].join("\n"),
            };
          },
        }),
        list: cliCommand({
          summary: "Показать избранные шаблоны, начиная с недавно использованных",
          options: { json: JSON_OPTION },
          run({ options }) {
            const prompts = store.list();
            if (options.json) {
              return {
                exitCode: 0,
                stdout: JSON.stringify(
                  prompts.map((prompt) => ({
                    id: prompt.id,
                    title: prompt.title,
                    prompt: prompt.prompt,
                    createdAt: prompt.createdAt,
                    lastUsedAt: prompt.lastUsedAt,
                  })),
                ),
              };
            }
            return {
              exitCode: 0,
              stdout:
                prompts.length > 0
                  ? prompts
                      .map(
                        (prompt) =>
                          `${prompt.id}  ${prompt.title === null ? "" : `${prompt.title} — `}${buildSnippet(prompt.prompt.text, []).text}`,
                      )
                      .join("\n")
                  : "Нет избранных шаблонов",
            };
          },
        }),
        star: cliCommand({
          summary:
            "Добавить запрос в избранное; существующий текст сохраняет название (для переименования используйте prompts title)",
          positionals: [
            {
              name: "text",
              description: "Текст запроса",
              required: true,
              variadic: true,
            },
          ],
          options: {
            title: {
              type: "string",
              description: "Необязательное название (до 120 символов)",
            },
            json: JSON_OPTION,
          },
          run({ options, positionals }) {
            const starred = star(
              {
                text: positionals.text.join(" "),
                mentions: [],
              },
              promptTitleSchema.parse(options.title ?? null),
            );
            return {
              exitCode: 0,
              stdout: options.json
                ? JSON.stringify({
                    id: starred.id,
                    title: starred.title,
                    text: starred.prompt.text,
                  })
                : starred.id,
            };
          },
        }),
        title: cliCommand({
          summary: "Переименовать избранный шаблон; --clear удаляет название",
          positionals: [
            { name: "id", description: "ID избранного шаблона", required: true },
            {
              name: "title",
              description: "Новое название (до 120 символов)",
              variadic: true,
            },
          ],
          options: {
            clear: { type: "boolean", description: "Удалить название" },
            json: JSON_OPTION,
          },
          run({ options, positionals }) {
            if (
              options.clear
                ? positionals.title.length > 0
                : positionals.title.length === 0
            ) {
              throw new PluginCliError(
                "Укажите название или --clear, но не оба варианта.",
                { code: "invalid_arguments" },
              );
            }
            const title = promptTitleSchema.parse(
              options.clear ? null : positionals.title.join(" "),
            );
            const result = setTitle(positionals.id, title);
            return {
              exitCode: 0,
              stdout: options.json
                ? JSON.stringify(result)
                : title === null
                  ? `Название ${result.id} удалено`
                  : `${result.id} переименован в ${title}`,
            };
          },
        }),
        unstar: cliCommand({
          summary: "Убрать шаблон из избранного",
          positionals: [
            {
              name: "id",
              description: "ID избранного шаблона из вывода `bb prompts list`",
              required: true,
            },
          ],
          options: { json: JSON_OPTION },
          run({ options, positionals }) {
            if (!store.unstar(positionals.id)) {
              throw new PluginCliError(
                `Неизвестный шаблон в избранном: ${positionals.id}`,
                {
                  code: "unknown_prompt",
                  hint: "Выполните `bb prompts list`, чтобы увидеть ID избранных шаблонов.",
                },
              );
            }
            return {
              exitCode: 0,
              stdout: options.json
                ? JSON.stringify({ id: positionals.id, unstarred: true })
                : `${positionals.id} убран из избранного`,
            };
          },
        }),
      },
    }),
  );
}
