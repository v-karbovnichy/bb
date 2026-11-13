import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  definePluginApp,
  experimental_Icon as Icon,
  useRpc,
  type StandardSchemaV1InferOutput,
} from "@get-bb/plugin-sdk/app";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { acpRegistryRpcContract } from "./src/registry-service.js";

type RegistryView = StandardSchemaV1InferOutput<
  (typeof acpRegistryRpcContract)["listRegistry"]["output"]
>;
type RegistryAgent = RegistryView["agents"][number];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const STATUS_BADGES: Partial<Record<RegistryAgent["status"], string>> = {
  added: "Добавлен",
  "update-available": "Доступно обновление",
  "built-in": "Встроен",
  "manual-install": "Ручная установка",
};

function matchesQuery(agent: RegistryAgent, query: string): boolean {
  const needle = query.trim().toLowerCase();
  return (
    needle === "" ||
    [agent.id, agent.name, agent.description, ...agent.authors].some((text) =>
      text.toLowerCase().includes(needle),
    )
  );
}

function agentNote(agent: RegistryAgent): string | null {
  if (agent.status === "built-in") {
    return "Этот агент уже входит в bb как провайдер.";
  }
  if (agent.status === "manual-install") {
    return "Доступен только как исполняемый файл. Установите его и добавьте команду в разделе пользовательских агентов.";
  }
  return agent.command === null ? null : `Команда: ${agent.command}`;
}

function AcpRegistrySettings() {
  const rpc = useRpc<typeof acpRegistryRpcContract>();
  const [view, setView] = useState<RegistryView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>("load");
  const [query, setQuery] = useState("");
  const activeRef = useRef(true);

  const settle = useCallback((request: Promise<RegistryView>): void => {
    void request
      .then((next) => {
        if (activeRef.current) setView(next);
      })
      .catch((requestError: unknown) => {
        if (activeRef.current) setError(errorMessage(requestError));
      })
      .finally(() => {
        if (activeRef.current) setBusy(null);
      });
  }, []);

  const run = useCallback(
    (key: string, request: () => Promise<RegistryView>): void => {
      setBusy(key);
      setError(null);
      settle(request());
    },
    [settle],
  );

  useEffect(() => {
    activeRef.current = true;
    settle(rpc.call("listRegistry", { refresh: false }));
    return () => {
      activeRef.current = false;
    };
  }, [rpc, settle]);

  const agents = useMemo(
    () => (view?.agents ?? []).filter((agent) => matchesQuery(agent, query)),
    [query, view],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-medium text-foreground">
            Каталог агентов
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Агенты из официального каталога ACP. После добавления агент
            появится среди провайдеров в новом чате и будет запускаться через
            npx или uvx на компьютере, где работает чат.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy !== null}
          onClick={() =>
            run("refresh", () => rpc.call("listRegistry", { refresh: true }))
          }
        >
          {busy === "refresh" ? "Обновление…" : "Обновить"}
        </Button>
      </div>

      <Input
        type="search"
        value={query}
        placeholder="Поиск агентов"
        aria-label="Поиск агентов"
        onChange={(event) => setQuery(event.target.value)}
      />

      <div className="overflow-hidden rounded-md border border-border/60">
        {view === null ? (
          <p className="px-3 py-4 text-sm text-muted-foreground">
            {error === null ? "Загрузка каталога…" : "Агентов пока нет."}
          </p>
        ) : agents.length === 0 ? (
          <p className="px-3 py-4 text-sm text-muted-foreground">
            {view.agents.length === 0
              ? "Агентов пока нет."
              : "Подходящие агенты не найдены."}
          </p>
        ) : (
          <div className="divide-y divide-border/60">
            {agents.map((agent) => {
              const badge = STATUS_BADGES[agent.status];
              const note = agentNote(agent);
              const canAdd =
                agent.status === "available" ||
                agent.status === "update-available";
              const canRemove =
                agent.status === "added" || agent.status === "update-available";
              return (
                <div
                  key={agent.id}
                  className="flex items-start gap-3 px-3 py-2.5"
                >
                  <Icon
                    name={agent.icon ?? "Toolbox"}
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-foreground">
                        {agent.name}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {agent.version}
                      </span>
                      {badge === undefined ? null : (
                        <Badge variant="secondary">{badge}</Badge>
                      )}
                    </div>
                    {agent.description === "" ? null : (
                      <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                        {agent.description}
                      </p>
                    )}
                    {note === null ? null : (
                      <p className="mt-0.5 break-all text-xs leading-relaxed text-muted-foreground">
                        {note}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {canAdd ? (
                      <Button
                        type="button"
                        size="sm"
                        disabled={busy !== null}
                        aria-label={`${agent.status === "available" ? "Добавить" : "Обновить"} ${agent.name}`}
                        onClick={() =>
                          run(agent.id, () =>
                            rpc.call("addRegistryAgent", { id: agent.id }),
                          )
                        }
                      >
                        {agent.status === "available" ? "Добавить" : "Обновить"}
                      </Button>
                    ) : null}
                    {canRemove ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busy !== null}
                        aria-label={`Удалить ${agent.name}`}
                        onClick={() =>
                          run(agent.id, () =>
                            rpc.call("removeAgent", { id: agent.id }),
                          )
                        }
                      >
                        Удалить
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex min-h-5 justify-end" aria-live="polite">
        {error !== null ? (
          <span className="text-xs text-destructive" role="alert">
            {error}
          </span>
        ) : view?.error != null ? (
          <span className="text-xs text-muted-foreground" role="status">
            {view.agents.length === 0
              ? `Не удалось связаться с каталогом: ${view.error}`
              : `Показана сохранённая копия. Не удалось связаться с каталогом: ${view.error}`}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.settingsSection({
    id: "registry",
    component: AcpRegistrySettings,
  });
});
