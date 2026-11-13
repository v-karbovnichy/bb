import { useCallback, useEffect, useRef, useState } from "react";
import {
  definePluginApp,
  UrlLink,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import { cn } from "@bb/shared-ui/lib/utils";
import type { connectNextRpcContract } from "./src/rpc.js";
import {
  CONNECT_NEXT_REALTIME_CHANNEL,
  connectNextStatusSchema,
  type ConnectNextStatus,
} from "./src/types.js";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function asStatus(value: unknown): ConnectNextStatus | null {
  const parsed = connectNextStatusSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

type Tone = "ok" | "warn" | "bad" | "muted";

const STATE_COPY: Record<
  ConnectNextStatus["state"],
  { label: string; tone: Tone }
> = {
  off: { label: "Выключено", tone: "muted" },
  "signed-out": { label: "Ожидание входа в аккаунт bb", tone: "muted" },
  connecting: { label: "Подключение…", tone: "warn" },
  connected: { label: "Подключено", tone: "ok" },
  refused: { label: "Шлюз отклонил учётные данные bb", tone: "bad" },
  offline: { label: "Нет связи со шлюзом", tone: "warn" },
  error: { label: "Не удалось запустить туннель", tone: "bad" },
};

const SHARE_TONE: Record<ConnectNextStatus["shares"][number]["state"], Tone> = {
  active: "ok",
  pending: "warn",
  refused: "bad",
};

function StatusDot({ tone }: { tone: Tone }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "size-2 shrink-0 rounded-full",
        tone === "ok" && "bg-success",
        tone === "warn" && "animate-pulse bg-warning",
        tone === "bad" && "bg-destructive",
        tone === "muted" && "bg-muted-foreground/50",
      )}
    />
  );
}

const MACHINE_STATE_COPY: Record<
  ConnectNextStatus["machines"][number]["state"],
  { label: string; tone: Tone }
> = {
  idle: { label: "Ожидание", tone: "muted" },
  connecting: { label: "Подключение…", tone: "warn" },
  connected: { label: "Подключено", tone: "ok" },
  refused: { label: "Учётные данные отклонены", tone: "bad" },
  offline: { label: "Нет связи со шлюзом", tone: "warn" },
  error: { label: "Не удалось запустить туннель", tone: "bad" },
};

function ShareList({
  title,
  label,
  shares,
}: {
  title: string | null;
  label: string;
  shares: ConnectNextStatus["shares"];
}) {
  return (
    <div className="space-y-1">
      {title === null ? null : (
        <p className="text-xs font-medium text-muted-foreground">{title}</p>
      )}
      <ul className="space-y-1" aria-label={label}>
        {shares.map((share) => (
          <li key={share.port} className="flex items-center gap-2">
            <StatusDot tone={SHARE_TONE[share.state]} />
            <span className="shrink-0 font-mono text-xs tabular-nums">
              :{share.port}
            </span>
            {share.state === "active" ? (
              <UrlLink
                href={share.url}
                target="_blank"
                rel="noreferrer"
                className="min-w-0 truncate font-mono text-xs text-muted-foreground hover:underline"
              >
                {share.url}
              </UrlLink>
            ) : (
              <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
                {share.url}
              </span>
            )}
            {share.error !== null ? (
              <span className="min-w-0 truncate text-xs text-muted-foreground">
                {share.error}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function useConnectNextStatus() {
  const rpc = useRpc<typeof connectNextRpcContract>();
  const connectionState = useRealtimeConnectionState();
  const [status, setStatus] = useState<ConnectNextStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const latest = useRef(0);

  const refetch = useCallback(() => {
    const request = ++latest.current;
    rpc.call("status").then(
      (result) => {
        if (request !== latest.current) return;
        const next = asStatus(result);
        setStatus(next);
        setLoadError(next === null ? "Неожиданный формат данных о состоянии." : null);
      },
      (error: unknown) => {
        if (request !== latest.current) return;
        setLoadError(errorText(error));
      },
    );
  }, [rpc]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const previousConnectionState = useRef(connectionState);
  useEffect(() => {
    const previous = previousConnectionState.current;
    previousConnectionState.current = connectionState;
    if (connectionState === "connected" && previous !== "connected") refetch();
  }, [connectionState, refetch]);

  useRealtime(CONNECT_NEXT_REALTIME_CHANNEL, (payload) => {
    const next = asStatus(payload);
    if (next === null) return;
    latest.current += 1;
    setStatus(next);
    setLoadError(null);
  });

  return { status, loadError };
}

function ConnectNextSettingsSection() {
  const { status, loadError } = useConnectNextStatus();

  if (loadError !== null) {
    return (
      <p role="alert" className="text-sm text-destructive-text">
        Не удалось загрузить состояние connect next: {loadError}
      </p>
    );
  }
  if (status === null) {
    return <p className="text-sm text-muted-foreground">Загрузка…</p>;
  }

  const copy = STATE_COPY[status.state];
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2" role="status">
        <StatusDot tone={copy.tone} />
        <span className="text-sm font-medium">{copy.label}</span>
      </div>
      {status.url !== null && status.state === "connected" ? (
        <UrlLink
          href={status.url}
          target="_blank"
          rel="noreferrer"
          className="block truncate font-mono text-sm text-foreground hover:underline"
        >
          {status.url}
        </UrlLink>
      ) : status.url !== null ? (
        <p className="truncate font-mono text-sm text-muted-foreground">
          {status.url}
        </p>
      ) : null}
      {!status.enabled ? (
        <p className="text-xs text-muted-foreground">
          Включите переключатель выше или выполните <code>bb connect-next on</code>.
        </p>
      ) : null}
      {status.lastError !== null && status.state !== "connected" ? (
        <p className="text-xs text-muted-foreground">{status.lastError}</p>
      ) : null}
      {status.shares.length > 0 ? (
        <ShareList
          title="Открытые порты"
          label="Открытые порты по новому адресу"
          shares={status.shares}
        />
      ) : null}
      {status.machines.map((machine) => (
        <div key={machine.hostId} className="space-y-1">
          <div className="flex items-center gap-2">
            <StatusDot tone={MACHINE_STATE_COPY[machine.state].tone} />
            <span className="min-w-0 truncate text-xs font-medium">
              {machine.hostName}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {MACHINE_STATE_COPY[machine.state].label}
            </span>
          </div>
          {machine.lastError !== null && machine.state !== "connected" ? (
            <p className="text-xs text-muted-foreground">{machine.lastError}</p>
          ) : null}
          {machine.shares.length > 0 ? (
            <ShareList
              title={null}
              label={`Открытые порты машины ${machine.hostName} по новому адресу`}
              shares={machine.shares}
            />
          ) : null}
        </div>
      ))}
      <p className="text-xs text-muted-foreground">
        Текущий адрес bb connect продолжает работать вместе с новым. Порты,
        открытые командой <code>bb connect expose</code> на этой или другой
        подключённой машине, также доступны по новому адресу.
      </p>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.settingsSection({
    id: "connect-next",
    description:
      "Бета: дополнительный доступ к bb через новый шлюз Fly по адресу next.<домен вашего аккаунта bb>.",
    component: ConnectNextSettingsSection,
  });
});
