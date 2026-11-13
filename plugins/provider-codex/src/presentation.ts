import {
  type DeltaPresentation,
  experimental_presentationDetail as presentationDetail,
  experimental_presentationFileName as presentationFileName,
  experimental_presentationTitle as presentationTitle,
  experimental_toolPresentation as toolPresentation,
  experimental_withTitle as withTitle,
} from "@get-bb/plugin-sdk/provider-bridge";

const SHELL_WRAPPER_PATTERN =
  /^(?:\S*\/)?(?:sh|bash|zsh)\s+(?:-lc|-c)\s+([\s\S]+)$/;

function unwrapShellCommand(command: string): string {
  const trimmed = command.trim();
  const match = SHELL_WRAPPER_PATTERN.exec(trimmed);
  if (!match?.[1]) {
    return trimmed;
  }
  const inner = match[1].trim();
  const quote = inner[0];
  if (
    inner.length >= 2 &&
    (quote === '"' || quote === "'") &&
    inner[inner.length - 1] === quote
  ) {
    return inner.slice(1, -1);
  }
  return inner;
}

export const AGENT_MESSAGE_PRESENTATION: DeltaPresentation = {
  label: { pending: "Ответ", completed: "Ответ готов" },
  icon: { glyph: "MessageSquare" },
};

export const PLAN_PRESENTATION: DeltaPresentation = {
  label: { pending: "Составление плана", completed: "План составлен" },
  icon: { glyph: "ListTodo" },
};

export const IMAGE_VIEW_PRESENTATION: DeltaPresentation = {
  label: { pending: "Просмотр изображения", completed: "Изображение просмотрено" },
  icon: { glyph: "Eye" },
};

export const IMAGE_GENERATION_PRESENTATION: DeltaPresentation = {
  label: { pending: "Создание изображения", completed: "Изображение создано" },
  icon: { glyph: "Palette" },
};

export function commandPresentation(command: string): DeltaPresentation {
  return withTitle(
    {
      label: { pending: "Выполнение команды", completed: "Команда выполнена" },
      icon: { glyph: "Terminal" },
    },
    presentationTitle(unwrapShellCommand(command)),
  );
}

export function fileChangePresentation(
  paths: readonly string[],
): DeltaPresentation {
  const names = [...new Set(paths.map(presentationFileName))];
  const plural = names.length > 1;
  return withTitle(
    {
      label: {
        pending: plural ? "Изменение файлов" : "Изменение файла",
        completed: plural ? "Файлы изменены" : "Файл изменён",
      },
      icon: { glyph: "EditFile" },
    },
    names.length === 0 ? undefined : presentationTitle(names.join(", ")),
  );
}

export function imageViewPresentation(path: string): DeltaPresentation {
  return withTitle(
    IMAGE_VIEW_PRESENTATION,
    presentationTitle(presentationFileName(path)),
  );
}

export function imageGenerationPresentation(args: {
  path: string | null;
  prompt: string | null;
}): DeltaPresentation {
  const title = args.path
    ? presentationTitle(presentationFileName(args.path))
    : args.prompt
      ? presentationTitle(args.prompt)
      : undefined;
  return withTitle(IMAGE_GENERATION_PRESENTATION, title);
}

export function planStepsPresentation(args: {
  steps: readonly { step: string; status: string }[];
  explanation: string | null;
}): DeltaPresentation {
  const active = args.steps.find((step) => step.status === "active");
  const headline = active?.step ?? args.explanation ?? undefined;
  return withTitle(
    {
      label: { pending: "Обновление плана", completed: "План обновлён" },
      icon: { glyph: "ListTodo" },
    },
    headline === undefined ? undefined : presentationTitle(headline),
  );
}

const NODE_REPL_SERVER = "node_repl";

function nodeReplPresentation(
  tool: string,
  args: unknown,
): DeltaPresentation | null {
  if (tool === "js_reset") {
    return {
      label: {
        pending: "Сброс сеанса JavaScript",
        completed: "Сеанс JavaScript сброшен",
      },
      icon: { glyph: "Code" },
    };
  }
  if (tool !== "js") {
    return null;
  }
  const title =
    args !== null &&
    typeof args === "object" &&
    "title" in args &&
    typeof args.title === "string"
      ? presentationTitle(args.title)
      : undefined;
  return withTitle(
    {
      label: { pending: "Выполнение JavaScript", completed: "JavaScript выполнен" },
      icon: { glyph: "Code" },
    },
    title,
  );
}

export function mcpToolPresentation(args: {
  server: string;
  tool: string;
  args: unknown;
}): DeltaPresentation {
  if (args.server === NODE_REPL_SERVER) {
    const nodeRepl = nodeReplPresentation(args.tool, args.args);
    if (nodeRepl !== null) {
      return nodeRepl;
    }
  }
  return withTitle(toolPresentation(args.tool), args.server);
}

export function macOsPermissionPresentation(
  requested: readonly string[],
): DeltaPresentation {
  const presentation: DeltaPresentation = {
    label: {
      pending: "Запрос разрешений macOS",
      completed: "Разрешения macOS запрошены",
    },
    icon: { glyph: "Lock" },
  };
  const detail =
    requested.length === 0
      ? "Разрешения macOS не запрашивались."
      : `Запрошено: ${requested.join(", ")}. bb не может выдать разрешения macOS; подтверждение относится только к команде.`;
  return { ...presentation, detail: presentationDetail(detail) };
}

const COLLAB_AGENT_LABELS: Readonly<
  Record<string, DeltaPresentation["label"]>
> = {
  spawnAgent: { pending: "Запуск агента", completed: "Агент запущен" },
  wait: { pending: "Ожидание агентов", completed: "Ожидание агентов завершено" },
  resumeAgent: { pending: "Возобновление агента", completed: "Агент возобновлён" },
  sendInput: { pending: "Отправка сообщения агенту", completed: "Сообщение агенту отправлено" },
  closeAgent: { pending: "Завершение агента", completed: "Агент завершён" },
};

export function collabAgentPresentation(args: {
  tool: string;
  prompt: string | null;
}): DeltaPresentation {
  const label = COLLAB_AGENT_LABELS[args.tool] ?? {
    pending: `Выполнение ${args.tool}`,
    completed: `Выполнено ${args.tool}`,
  };
  return withTitle(
    { label, icon: { glyph: "UserRound" } },
    args.prompt === null ? undefined : presentationTitle(args.prompt),
  );
}

export function subAgentPresentation(agentPath: string): DeltaPresentation {
  return withTitle(
    {
      label: { pending: "Работа агента", completed: "Агент завершил работу" },
      icon: { glyph: "UserRound" },
    },
    presentationTitle(agentPath),
  );
}
