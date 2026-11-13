import type { ExperimentalFileOpenOptions } from "@get-bb/plugin-sdk";
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@bb/shared-ui/context-menu";
import { useLiveFileOpenTargets } from "@/hooks/useLiveFileOpenTargets";
import { resolveLiveFilePath } from "@/hooks/useResolvedLiveFileTarget";
import { useAppNavigationHost } from "@/lib/app-navigation-host";
import { copyToClipboardWithToast } from "@/lib/clipboard";
import {
  getFileBasename,
  getExperimentalFileLocationStart,
} from "@/lib/live-file-navigation";
import { usePluginSlots } from "@/lib/plugin-slots";

function getFileExtension(path: string): string | null {
  const name = getFileBasename(path);
  const dotIndex = name.lastIndexOf(".");
  return dotIndex > 0 && dotIndex < name.length - 1
    ? name.slice(dotIndex + 1).toLowerCase()
    : null;
}

export function ExperimentalFileLinkMenu({
  intent,
}: {
  intent: ExperimentalFileOpenOptions;
}) {
  const navigation = useAppNavigationHost();
  const localTargets = useLiveFileOpenTargets(intent.target);
  const absolutePath =
    localTargets.root.status === "available"
      ? resolveLiveFilePath(localTargets.root, intent.target.path)
      : null;
  const { fileOpeners } = usePluginSlots();
  const extension = getFileExtension(intent.target.path);
  const matchingOpeners =
    extension === null ||
    (intent.target.kind === "workspace" &&
      intent.target.experimental_ref !== undefined)
      ? []
      : fileOpeners.filter((opener) => opener.extensions.includes(extension));
  const location = getExperimentalFileLocationStart(intent.location);

  return (
    <>
      <ContextMenuItem onSelect={() => navigation.openFilePreview(intent)}>
        Открыть предпросмотр
      </ContextMenuItem>
      {matchingOpeners.length > 0 ? (
        <ContextMenuSub>
          <ContextMenuSubTrigger>Открыть с помощью</ContextMenuSubTrigger>
          <ContextMenuSubContent className="min-w-52">
            <ContextMenuItem
              onSelect={() =>
                navigation.openFilePreview({ ...intent, viewer: "builtin" })
              }
            >
              Предпросмотр BB
            </ContextMenuItem>
            {matchingOpeners.map((opener) => (
              <ContextMenuItem
                key={`${opener.pluginId}:${opener.id}`}
                onSelect={() =>
                  navigation.openFilePreview({
                    ...intent,
                    viewer: {
                      pluginId: opener.pluginId,
                      openerId: opener.id,
                    },
                  })
                }
              >
                {opener.title}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
      ) : null}
      <ContextMenuItem
        disabled={!localTargets.canOpenExternally}
        onSelect={() => navigation.openFileExternally(intent)}
      >
        Открыть во внешнем приложении
      </ContextMenuItem>
      {absolutePath !== null && localTargets.fileOpenTargets.length > 0 ? (
        <ContextMenuSub>
          <ContextMenuSubTrigger>Открыть в</ContextMenuSubTrigger>
          <ContextMenuSubContent className="min-w-52">
            {localTargets.fileOpenTargets.map((target) => (
              <ContextMenuItem
                key={target.id}
                onSelect={() => {
                  void localTargets.openPathInFileTarget({
                    columnNumber: location.columnNumber,
                    lineNumber: location.lineNumber,
                    path: absolutePath,
                    rememberTarget: false,
                    targetId: target.id,
                  });
                }}
              >
                {target.label}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
      ) : null}
      <ContextMenuSeparator />
      <ContextMenuItem
        onSelect={() => {
          void copyToClipboardWithToast(absolutePath ?? intent.target.path, {
            successMessage: "Путь к файлу скопирован",
            errorMessage: "Не удалось скопировать путь к файлу",
          });
        }}
      >
        Скопировать путь к файлу
      </ContextMenuItem>
      <ContextMenuItem
        onSelect={() => {
          void copyToClipboardWithToast(getFileBasename(intent.target.path), {
            successMessage: "Имя файла скопировано",
            errorMessage: "Не удалось скопировать имя файла",
          });
        }}
      >
        Скопировать имя файла
      </ContextMenuItem>
    </>
  );
}
