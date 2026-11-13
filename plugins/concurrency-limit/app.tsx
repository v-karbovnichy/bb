import { useCallback, useEffect, useRef, useState } from "react";
import {
  definePluginApp,
  useRealtime,
  useRpc,
  type StandardSchemaV1InferOutput,
} from "@get-bb/plugin-sdk/app";
import { Input } from "@/components/ui/input";
import {
  commitGlobalLimitDraft,
  commitHostLimitDraft,
  MAX_LIMIT_VALUE,
  type LimitDraftCommit,
} from "./limits.js";
import type { concurrencyLimitRpcContract } from "./server.js";

type ConfigurationView = StandardSchemaV1InferOutput<
  (typeof concurrencyLimitRpcContract)["getConfiguration"]["output"]
>;
type ConfigurationInput = Pick<
  ConfigurationView,
  "globalLimit" | "hostOverrides"
>;
type SaveState = "idle" | "saving" | "saved" | "error";

const CONFIGURATION_CHANGED_CHANNEL = "configuration-changed";
const GLOBAL_FIELD = "global";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function processorCount(count: number): string {
  const lastTwo = count % 100;
  const last = count % 10;
  const noun =
    lastTwo >= 11 && lastTwo <= 14
      ? "процессоров"
      : last === 1
        ? "процессор"
        : last >= 2 && last <= 4
          ? "процессора"
          : "процессоров";
  return `${count} ${noun}`;
}

function draftsFor(view: ConfigurationView): Record<string, string> {
  const drafts: Record<string, string> = {
    [GLOBAL_FIELD]: view.globalLimit === null ? "" : String(view.globalLimit),
  };
  for (const host of view.hosts) {
    drafts[host.id] = host.override === null ? "" : String(host.override);
  }
  return drafts;
}

function ConcurrencyLimitSettings() {
  const rpc = useRpc<typeof concurrencyLimitRpcContract>();
  const [view, setView] = useState<ConfigurationView | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [invalidField, setInvalidField] = useState<string | null>(null);
  const activeRef = useRef(true);
  const savingRef = useRef(false);

  const applyView = useCallback((next: ConfigurationView) => {
    setView(next);
    setDrafts(draftsFor(next));
  }, []);

  const refetch = useCallback(() => {
    if (savingRef.current) return;
    void rpc.call("getConfiguration").then(
      (configuration) => {
        if (!activeRef.current || savingRef.current) return;
        applyView(configuration);
        setError(null);
        setSaveState("saved");
      },
      (loadError: unknown) => {
        if (!activeRef.current) return;
        setError(errorMessage(loadError));
        setSaveState("error");
      },
    );
  }, [applyView, rpc]);

  useEffect(() => {
    activeRef.current = true;
    refetch();
    return () => {
      activeRef.current = false;
    };
  }, [refetch]);
  useRealtime(CONFIGURATION_CHANGED_CHANNEL, refetch);

  async function save(next: ConfigurationInput): Promise<void> {
    savingRef.current = true;
    setSaveState("saving");
    setError(null);
    try {
      const saved = await rpc.call("setConfiguration", next);
      if (!activeRef.current) return;
      applyView(saved);
      setSaveState("saved");
    } catch (saveError) {
      if (!activeRef.current) return;
      setError(errorMessage(saveError));
      setSaveState("error");
    } finally {
      savingRef.current = false;
    }
  }

  function changeDraft(field: string, value: string): void {
    setDrafts((current) => ({ ...current, [field]: value }));
    if (invalidField === field) setInvalidField(null);
  }

  function applyCommit(field: string, commit: LimitDraftCommit): void {
    if (commit.kind === "invalid") {
      setInvalidField(field);
      return;
    }
    if (commit.kind === "changed") void save(commit.configuration);
  }

  function commitGlobal(): void {
    if (view === null) return;
    applyCommit(
      GLOBAL_FIELD,
      commitGlobalLimitDraft(view, drafts[GLOBAL_FIELD] ?? ""),
    );
  }

  function commitHost(hostId: string): void {
    if (view === null) return;
    applyCommit(
      hostId,
      commitHostLimitDraft(view, hostId, drafts[hostId] ?? ""),
    );
  }

  if (view === null) {
    return (
      <p
        className={
          error === null
            ? "text-sm text-muted-foreground"
            : "text-sm text-destructive"
        }
        role={error === null ? "status" : "alert"}
      >
        {error ?? "Загрузка ограничений…"}
      </p>
    );
  }

  const disabled = saveState === "saving";
  const validationMessage = `Введите целое число от 0 до ${MAX_LIMIT_VALUE} или оставьте поле пустым.`;

  return (
    <div className="w-full space-y-5">
      <div className="flex items-start justify-between gap-6 pr-2">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-foreground">Общий лимит</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Оставьте поле пустым, чтобы снять общий лимит. Значение 0
            приостановит новые задачи.
          </p>
        </div>
        <Input
          aria-label="Общий лимит чатов"
          aria-invalid={invalidField === GLOBAL_FIELD}
          className="w-28 shrink-0"
          disabled={disabled}
          inputMode="numeric"
          max={MAX_LIMIT_VALUE}
          min={0}
          placeholder="Без ограничений"
          step={1}
          type="number"
          value={drafts[GLOBAL_FIELD] ?? ""}
          onBlur={commitGlobal}
          onChange={(event) => changeDraft(GLOBAL_FIELD, event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
      </div>

      <div className="border-t border-border/60 pt-4">
        <h3 className="text-sm font-medium text-foreground">Лимиты компьютеров</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Автоматический режим разрешает один чат на каждый доступный процессор.
        </p>

        <div className="ml-2 mt-2 border-l border-border/60 pl-2">
          {view.hosts.length === 0 ? (
            <p className="px-2 py-2 text-sm text-muted-foreground">
              Доступных компьютеров нет.
            </p>
          ) : (
            <div className="space-y-1">
              {view.hosts.map((host) => (
                <div
                  key={host.id}
                  className="flex min-h-14 items-center gap-3 rounded-md px-2 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-foreground">
                      {host.name}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {host.status === "disconnected"
                        ? host.availableParallelism === null
                          ? "Не в сети"
                          : `${processorCount(host.availableParallelism)} · Не в сети`
                        : host.availableParallelism === null
                          ? "Определение процессоров…"
                          : processorCount(host.availableParallelism)}
                    </div>
                  </div>
                  <Input
                    aria-label={`Лимит чатов: ${host.name}`}
                    aria-invalid={invalidField === host.id}
                    className="w-28 shrink-0"
                    disabled={disabled}
                    inputMode="numeric"
                    max={MAX_LIMIT_VALUE}
                    min={0}
                    placeholder={`Авто (${host.automaticLimit})`}
                    step={1}
                    type="number"
                    value={drafts[host.id] ?? ""}
                    onBlur={() => commitHost(host.id)}
                    onChange={(event) =>
                      changeDraft(host.id, event.target.value)
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.currentTarget.blur();
                    }}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex min-h-5 justify-end" aria-live="polite">
        {invalidField !== null ? (
          <span className="text-xs text-destructive" role="alert">
            {validationMessage}
          </span>
        ) : error !== null ? (
          <span className="text-xs text-destructive" role="alert">
            {error}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground" role="status">
            {saveState === "saving" ? "Сохранение…" : "Сохранено"}
          </span>
        )}
      </div>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.settingsSection({
    id: "configuration",
    component: ConcurrencyLimitSettings,
  });
});
