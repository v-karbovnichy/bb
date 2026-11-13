import { toast } from "sonner";
import { experimental_copyToClipboard } from "@get-bb/plugin-sdk/app";
import type * as MonacoNs from "monaco-editor";

type Editor = MonacoNs.editor.IStandaloneCodeEditor;

export type ActiveEditor = {
  editor: Editor;
  absolutePath: string;
  relativePath: string;
};

let lastFocused: ActiveEditor | null = null;

export function markEditorActive(active: ActiveEditor): void {
  lastFocused = active;
}

export function forgetEditor(editor: Editor): void {
  if (lastFocused?.editor === editor) lastFocused = null;
}

function targetEditor(): ActiveEditor | null {
  const node = lastFocused?.editor.getDomNode();
  if (!node || !node.isConnected || node.offsetParent === null) return null;
  return lastFocused;
}

function hasMultiLineSelection({ editor }: ActiveEditor): boolean {
  return (
    editor
      .getSelections()
      ?.some(
        (selection) =>
          !selection.isEmpty() &&
          selection.startLineNumber !== selection.endLineNumber,
      ) ?? false
  );
}

export type EditorCommand = {
  id: string;
  title: string;
  precondition?: (active: ActiveEditor) => boolean;
  run: (active: ActiveEditor) => void | Promise<void>;
};

function monacoAction(
  id: string,
  title: string,
  actionId: string,
  precondition?: (active: ActiveEditor) => boolean,
): EditorCommand {
  return {
    id,
    title,
    precondition,
    run: async ({ editor }) => {
      editor.focus();
      await editor.getAction(actionId)?.run();
    },
  };
}

export async function copy(text: string, successMessage: string): Promise<void> {
  if (await experimental_copyToClipboard({ text })) {
    toast.success(successMessage);
  } else {
    toast.error("Не удалось скопировать");
  }
}

export const EDITOR_COMMANDS: readonly EditorCommand[] = [
  ...[1, 2, 3, 4, 5].map((level) =>
    monacoAction(
      `fold-level-${level}`,
      `Monaco: fold level ${level}`,
      `editor.foldLevel${level}`,
    ),
  ),
  monacoAction(
    "fold-recursively",
    "Monaco: свернуть рекурсивно",
    "editor.foldRecursively",
  ),
  monacoAction("unfold-all", "Monaco: развернуть всё", "editor.unfoldAll"),
  monacoAction(
    "unfold-recursively",
    "Monaco: развернуть рекурсивно",
    "editor.unfoldRecursively",
  ),
  monacoAction("unfold", "Monaco: развернуть у курсора", "editor.unfold"),
  monacoAction(
    "sort-lines-ascending",
    "Monaco: сортировать выделенные строки по возрастанию",
    "editor.action.sortLinesAscending",
    hasMultiLineSelection,
  ),
  monacoAction(
    "sort-lines-descending",
    "Monaco: сортировать выделенные строки по убыванию",
    "editor.action.sortLinesDescending",
    hasMultiLineSelection,
  ),
  {
    id: "copy-path",
    title: "Monaco: скопировать путь к текущему файлу",
    run: ({ absolutePath }) => copy(absolutePath, "Абсолютный путь скопирован"),
  },
  {
    id: "copy-relative-path",
    title: "Monaco: скопировать относительный путь к текущему файлу",
    run: ({ relativePath }) => copy(relativePath, "Относительный путь скопирован"),
  },
];

export function isCommandAvailable(command: EditorCommand): boolean {
  const active = targetEditor();
  if (!active) return false;
  return command.precondition?.(active) ?? true;
}

export async function runEditorCommand(command: EditorCommand): Promise<void> {
  const active = targetEditor();
  if (!active || !(command.precondition?.(active) ?? true)) return;
  await command.run(active);
}
