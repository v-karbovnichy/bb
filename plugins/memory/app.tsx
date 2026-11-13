import { Fragment, useCallback, useEffect, useState } from "react";
import {
  definePluginApp,
  useRpc,
  type PluginRpcResult,
} from "@get-bb/plugin-sdk/app";
import type { memoryRpcContract } from "./server.js";
import { isMemoryKind, MEMORY_KINDS } from "./memory-kinds.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

type MemoryRecord = PluginRpcResult<
  (typeof memoryRpcContract)["listMemories"]
>["memories"][number];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function MemoryEditor({
  memory,
  onCancel,
  onSaved,
}: {
  memory: MemoryRecord;
  onCancel: () => void;
  onSaved: (memory: MemoryRecord) => void;
}) {
  const rpc = useRpc<typeof memoryRpcContract>();
  const [draft, setDraft] = useState(memory);
  const [tags, setTags] = useState(memory.tags.join(", "));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="@container/memory-editor space-y-3 rounded-md border border-border bg-muted/20 p-3">
      <div className="grid gap-3 @min-[36rem]/memory-editor:grid-cols-2">
        <label className="space-y-1 text-xs text-muted-foreground">
          Краткое описание
          <Input
            aria-label="Краткое описание воспоминания"
            value={draft.summary}
            maxLength={400}
            onChange={(event) =>
              setDraft({ ...draft, summary: event.target.value })
            }
          />
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          Теги
          <Input
            aria-label="Теги воспоминания"
            value={tags}
            placeholder="через запятую"
            onChange={(event) => setTags(event.target.value)}
          />
        </label>
      </div>
      <label className="block space-y-1 text-xs text-muted-foreground">
        Подробности
        <Textarea
          aria-label="Подробности воспоминания"
          value={draft.details}
          maxLength={16_000}
          className="min-h-28 resize-y text-sm"
          onChange={(event) =>
            setDraft({ ...draft, details: event.target.value })
          }
        />
      </label>
      <div className="grid gap-3 @min-[32rem]/memory-editor:grid-cols-3">
        <label className="space-y-1 text-xs text-muted-foreground">
          Тип
          <select
            aria-label="Тип воспоминания"
            value={draft.kind}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
            onChange={(event) => {
              if (isMemoryKind(event.target.value)) {
                setDraft({ ...draft, kind: event.target.value });
              }
            }}
          >
            {MEMORY_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {({ fact: "Факт", preference: "Предпочтение", decision: "Решение", procedure: "Процедура", episode: "Событие", reference: "Справка" } as Record<string, string>)[kind] ?? kind}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          Важность
          <Input
            aria-label="Важность воспоминания"
            type="number"
            min={0}
            max={100}
            value={draft.importance}
            onChange={(event) =>
              setDraft({ ...draft, importance: Number(event.target.value) })
            }
          />
        </label>
        <label className="flex items-end gap-2 pb-2 text-sm">
          <Switch
            aria-label="Закреплённое воспоминание"
            checked={draft.pinned}
            onCheckedChange={(pinned) => setDraft({ ...draft, pinned })}
          />
          Закреплено
        </label>
      </div>
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" disabled={saving} onClick={onCancel}>
          Отмена
        </Button>
        <Button
          size="sm"
          disabled={saving}
          onClick={() => {
            setSaving(true);
            setError(null);
            void rpc
              .call("updateMemory", {
                id: draft.id,
                expectedVersion: draft.version,
                summary: draft.summary,
                details: draft.details,
                kind: draft.kind,
                tags: tags
                  .split(",")
                  .map((tag) => tag.trim())
                  .filter(Boolean),
                importance: draft.importance,
                pinned: draft.pinned,
              })
              .then((result) => result.memory)
              .then(onSaved)
              .catch((saveError: unknown) => setError(errorMessage(saveError)))
              .finally(() => setSaving(false));
          }}
        >
          {saving ? "Сохранение…" : "Сохранить"}
        </Button>
      </div>
    </div>
  );
}

function MemorySettings() {
  const rpc = useRpc<typeof memoryRpcContract>();
  const [memories, setMemories] = useState<MemoryRecord[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setMemories((await rpc.call("listMemories")).memories);
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [rpc]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return <p className="text-sm text-muted-foreground">Загрузка воспоминаний…</p>;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border bg-muted/20 p-3 text-sm text-muted-foreground">
        Этот плагин использует общую память для всех провайдеров. Рекомендуем
        отключить память провайдеров в разделе Настройки → Плагины → Claude Code provider
        и Codex provider, чтобы избежать дублирования и конфликтов.
      </div>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {memories.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Пока нет сохранённых воспоминаний.
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-border">
          <table className="w-full table-fixed text-sm">
            <thead className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="w-auto px-3 py-2 font-medium">Воспоминание</th>
                <th className="w-24 px-3 py-2 font-medium">Область</th>
                <th className="w-28 px-3 py-2 text-right font-medium">
                  Действия
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {memories.map((memory) => (
                <Fragment key={memory.id}>
                  <tr className="align-top">
                    <td className="min-w-0 px-3 py-3">
                      <div className="truncate font-medium text-foreground">
                        {memory.pinned ? "📌 " : ""}
                        {memory.name}
                      </div>
                      <div className="mt-1 line-clamp-2 break-words text-muted-foreground">
                        {memory.summary}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span>{({ fact: "Факт", preference: "Предпочтение", decision: "Решение", procedure: "Процедура", episode: "Событие", reference: "Справка" } as Record<string, string>)[memory.kind] ?? memory.kind}</span>
                        <span>важность {memory.importance}</span>
                        <span>
                          обновлено{" "}
                          {new Date(memory.updatedAt).toLocaleDateString()}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">
                      <div>{memory.scope === "project" ? "проект" : "общая"}</div>
                      {memory.projectId ? (
                        <div
                          className="mt-1 max-w-36 truncate text-xs"
                          title={memory.projectId}
                        >
                          {memory.projectId}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-col items-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setEditingId((current) =>
                              current === memory.id ? null : memory.id,
                            )
                          }
                        >
                          Изменить
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={deletingId === memory.id}
                          className="text-destructive hover:text-destructive"
                          onClick={() => {
                            if (
                              !window.confirm(`Удалить воспоминание «${memory.name}»?`)
                            ) {
                              return;
                            }
                            setDeletingId(memory.id);
                            setError(null);
                            void rpc
                              .call("deleteMemory", {
                                id: memory.id,
                                expectedVersion: memory.version,
                              })
                              .then(() => {
                                setMemories((current) =>
                                  current.filter(
                                    (entry) => entry.id !== memory.id,
                                  ),
                                );
                                setEditingId((current) =>
                                  current === memory.id ? null : current,
                                );
                              })
                              .catch((deleteError: unknown) =>
                                setError(errorMessage(deleteError)),
                              )
                              .finally(() => setDeletingId(null));
                          }}
                        >
                          {deletingId === memory.id ? "Удаление…" : "Удалить"}
                        </Button>
                      </div>
                    </td>
                  </tr>
                  {editingId === memory.id ? (
                    <tr>
                      <td colSpan={3} className="bg-muted/10 p-3">
                        <MemoryEditor
                          memory={memory}
                          onCancel={() => setEditingId(null)}
                          onSaved={(updated) => {
                            setMemories((current) =>
                              current.map((entry) =>
                                entry.id === updated.id ? updated : entry,
                              ),
                            );
                            setEditingId(null);
                          }}
                        />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.settingsSection({
    id: "memory",
    title: "Память",
    description:
      "Просмотр и управление общей памятью и памятью проектов, независимой от провайдера.",
    component: MemorySettings,
  });
});
