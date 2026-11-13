import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  definePluginApp,
  UrlLink,
  useRealtime,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import { Button } from "@bb/shared-ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import { Icon } from "@bb/shared-ui/icon";
import { Input } from "@bb/shared-ui/input";
import { cn } from "@bb/shared-ui/lib/utils";
import type { accountPrivateRpcContract } from "./src/contract.js";
import {
  ACCOUNT_REALTIME_CHANNEL,
  accountRealtimePayloadSchema,
  type Account,
  type AccountStatus,
  type LoginView,
  type SignOutResult,
} from "./src/schemas.js";

const LOGIN_POLL_MS = 2_000;
const LOGIN_POLL_MAX_MS = 30_000;

function loginPollDelay(failures: number): number {
  return failures === 0
    ? LOGIN_POLL_MS
    : Math.min(LOGIN_POLL_MS * 2 ** failures, LOGIN_POLL_MAX_MS);
}

const DANGER_QUIET_CLASS =
  "text-destructive-text hover:text-destructive-text hover:bg-surface-destructive";

const ERROR_COPY: Record<string, string> = {
  invalid_code:
    "Этот код недействителен или истёк. Получите новый в панели getbb.app.",
  expired_code:
    "Срок действия кода истёк. Получите новый в панели getbb.app.",
  already_used:
    "Этот код уже использован. Получите новый в панели getbb.app.",
  network: "Нет связи с getbb.app. Проверьте подключение и повторите попытку.",
  rate_limited:
    "Слишком много попыток входа из этой сети. Подождите минуту и повторите попытку.",
  unavailable:
    "getbb.app сейчас не может обработать запрос. Повторите попытку через минуту.",
  unauthorized: "getbb.app отклонил привязку. Повторите попытку.",
  profile_unavailable:
    "bb сохранил привязку, но getbb.app пока не вернул данные аккаунта. bb продолжает попытки.",
  superseded:
    "Эту попытку сменил другой вход или выход. Проверьте аккаунт выше.",
};

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return ERROR_COPY[message] ?? message;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function formatPairingCode(raw: string): string {
  const cleaned = raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);
  return cleaned.length > 4
    ? `${cleaned.slice(0, 4)}-${cleaned.slice(4)}`
    : cleaned;
}

function isCompletePairingCode(formatted: string): boolean {
  return /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(formatted);
}

type AccountRpc = ReturnType<typeof useRpc<typeof accountPrivateRpcContract>>;

interface AccountState {
  status: AccountStatus;
  login: LoginView | null;
}

function useAccountState(): {
  state: AccountState | null;
  loadError: string | null;
  apply(next: AccountState): void;
  refetch(): void;
} {
  const rpc = useRpc<typeof accountPrivateRpcContract>();
  const [state, setState] = useState<AccountState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const apply = useCallback((next: AccountState) => {
    setState((previous) =>
      previous !== null && previous.status.revision > next.status.revision
        ? { status: previous.status, login: next.login }
        : next,
    );
    setLoadError(null);
  }, []);

  const refetch = useCallback(() => {
    rpc
      .call("login.poll", { loginId: null })
      .then(apply, (error: unknown) => setLoadError(errorText(error)));
  }, [apply, rpc]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  useRealtime(ACCOUNT_REALTIME_CHANNEL, (payload) => {
    const parsed = accountRealtimePayloadSchema.safeParse(payload);
    if (parsed.success) apply(parsed.data);
  });

  return { state, loadError, apply, refetch };
}

function Avatar({ account }: { account: Account }) {
  const [failed, setFailed] = useState(false);
  const initial = (account.githubLogin ?? account.name)
    .slice(0, 1)
    .toUpperCase();
  if (account.avatarUrl === null || failed) {
    return (
      <span
        aria-hidden="true"
        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-recessed text-sm font-semibold text-muted-foreground"
      >
        {initial}
      </span>
    );
  }
  return (
    <img
      src={account.avatarUrl}
      alt=""
      className="size-10 shrink-0 rounded-full border border-border"
      onError={() => setFailed(true)}
    />
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-3">
      <dt className="w-24 shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-sm">{children}</dd>
    </div>
  );
}

function SignOutDialog({
  open,
  onOpenChange,
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {open ? (
          <>
            <DialogHeader>
              <DialogTitle>Выйти из аккаунта bb?</DialogTitle>
              <DialogDescription>
                getbb.app отвяжет этот bb. Удалённый доступ и облачные сервисы
                перестанут работать до повторного входа.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => onOpenChange(false)}
              >
                Отмена
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={pending}
                onClick={onConfirm}
              >
                {pending ? (
                  <Icon name="Spinner" className="size-4 animate-spin" />
                ) : null}
                {pending ? "Выход…" : "Выйти"}
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function SignOutControl({
  rpc,
  onSignedOut,
}: {
  rpc: AccountRpc;
  onSignedOut: (result: SignOutResult) => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signOut = useCallback(() => {
    setPending(true);
    setError(null);
    rpc.call("signOut", null).then(
      (result) => {
        setPending(false);
        setConfirmOpen(false);
        onSignedOut(result);
      },
      (rpcError: unknown) => {
        setPending(false);
        setError(errorText(rpcError));
      },
    );
  }, [onSignedOut, rpc]);

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={DANGER_QUIET_CLASS}
        onClick={() => setConfirmOpen(true)}
      >
        Выйти
      </Button>
      {error !== null ? (
        <p className="text-xs text-destructive-text">{error}</p>
      ) : null}
      <SignOutDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        pending={pending}
        onConfirm={signOut}
      />
    </>
  );
}

function SignedInContent({
  account,
  rpc,
  onSignedOut,
}: {
  account: Account;
  rpc: AccountRpc;
  onSignedOut: (result: SignOutResult) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Avatar account={account} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{account.name}</p>
          {account.githubLogin !== null ? (
            <p className="truncate text-xs text-muted-foreground">
              @{account.githubLogin} в GitHub
            </p>
          ) : null}
        </div>
      </div>
      <dl className="space-y-1.5">
        <DetailRow label="Имя пользователя">
          {account.handle ?? "Пока не задано"}
        </DetailRow>
        <DetailRow label="Этот сервер">
          <span className="font-mono text-xs">{account.serverLabel}</span>
          <span className="text-muted-foreground">
            {" "}
            · {hostOf(account.serverUrl)}
          </span>
        </DetailRow>
      </dl>
      <div className="-mx-4 flex flex-wrap items-center gap-3 border-t border-border-seam px-4 pt-3">
        <span className="min-w-0 text-xs text-muted-foreground">
          Удалённый доступ и облачные сервисы используют этот аккаунт.
        </span>
        <span className="flex-1" />
        <SignOutControl rpc={rpc} onSignedOut={onSignedOut} />
      </div>
    </div>
  );
}

function ProfilePendingContent({
  rpc,
  onSignedOut,
}: {
  rpc: AccountRpc;
  onSignedOut: (result: SignOutResult) => void;
}) {
  return (
    <div className="space-y-4">
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon name="Spinner" className="size-4 animate-spin" />
        Этот bb привязан к getbb.app, но данные аккаунта ещё не загружены.
        Повторные попытки продолжаются.
      </p>
      <div className="-mx-4 flex flex-wrap items-center gap-3 border-t border-border-seam px-4 pt-3">
        <span className="min-w-0 text-xs text-muted-foreground">
          Удалённый доступ и облачные сервисы заработают после загрузки.
        </span>
        <span className="flex-1" />
        <SignOutControl rpc={rpc} onSignedOut={onSignedOut} />
      </div>
    </div>
  );
}

function signOutNotice(result: SignOutResult): ReactNode {
  if (result.revocation !== "failed") return null;
  return (
    <p className="text-xs text-destructive-text">
      Здесь выполнен выход, но getbb.app не подтвердил отзыв доступа у этого сервера (
      {result.message}). Удалите его через{" "}
      <UrlLink href={result.dashboardUrl} target="_blank" rel="noreferrer">
        панель управления
      </UrlLink>
      .
    </p>
  );
}

function PairCodeForm({
  rpc,
  onDone,
}: {
  rpc: AccountRpc;
  onDone: () => void;
}) {
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const complete = isCompletePairingCode(code);

  const submit = useCallback(() => {
    if (pending || !isCompletePairingCode(code)) return;
    setPending(true);
    setError(null);
    rpc.call("redeemCode", { code, baseUrl: null }).then(
      () => {
        setPending(false);
        setCode("");
        onDone();
      },
      (rpcError: unknown) => {
        setPending(false);
        setError(errorText(rpcError));
      },
    );
  }, [code, onDone, pending, rpc]);

  return (
    <div className="space-y-2">
      <form
        className="flex max-w-md items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Input
          value={code}
          onChange={(event) => {
            setCode(formatPairingCode(event.target.value));
            setError(null);
          }}
          placeholder="XXXX–XXXX"
          autoComplete="off"
          spellCheck={false}
          aria-label="Код привязки"
          aria-invalid={error !== null}
          className={cn(
            "font-mono tracking-widest",
            error !== null && "border-destructive ring-1 ring-destructive",
          )}
        />
        <Button type="submit" variant="outline" disabled={pending || !complete}>
          {pending ? (
            <Icon name="Spinner" className="size-4 animate-spin" />
          ) : null}
          Привязать
        </Button>
      </form>
      {error !== null ? (
        <p className="max-w-md text-xs text-destructive-text">{error}</p>
      ) : null}
    </div>
  );
}

function SignInDialogBody({
  login,
  starting,
  startError,
  onRetry,
}: {
  login: LoginView | null;
  starting: boolean;
  startError: string | null;
  onRetry: () => void;
}) {
  if (startError !== null) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-destructive-text">{startError}</p>
        <Button type="button" variant="outline" onClick={onRetry}>
          Повторить попытку
        </Button>
      </div>
    );
  }
  if (login === null || starting) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon name="Spinner" className="size-4 animate-spin" />
        Получение кода входа…
      </p>
    );
  }
  const pending = login.state === "pending";
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <p className="text-xs text-muted-foreground">
          Подтвердите этот код на {hostOf(login.verificationUrl)}:
        </p>
        <p
          aria-label="Код входа"
          className={cn(
            "font-mono text-base font-semibold tracking-widest",
            !pending && "text-muted-foreground line-through",
          )}
        >
          {login.userCode}
        </p>
      </div>
      {pending ? (
        <>
          <Button type="button" asChild>
            <UrlLink
              href={login.verificationUrl}
              target="_blank"
              rel="noreferrer"
            >
              Открыть getbb.app
              <Icon name="ExternalLink" className="size-3.5" />
            </UrlLink>
          </Button>
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Icon name="Spinner" className="size-3.5 animate-spin" />
            Ожидаем подтверждения. Подтвердить можно с любого устройства.
          </p>
        </>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-destructive-text">
            {login.message ?? "Вход не завершён."}
          </p>
          <Button type="button" variant="outline" onClick={onRetry}>
            Получить новый код
          </Button>
        </div>
      )}
    </div>
  );
}

function SignInDialog({
  open,
  onOpenChange,
  rpc,
  login,
  onLogin,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rpc: AccountRpc;
  login: LoginView | null;
  onLogin: (state: AccountState) => void;
}) {
  const [loginId, setLoginId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const startedForOpen = useRef(false);

  const start = useCallback(() => {
    setStarting(true);
    setStartError(null);
    rpc.call("login.start", { baseUrl: null }).then(
      (view) => {
        setStarting(false);
        setLoginId(view.id);
      },
      (error: unknown) => {
        setStarting(false);
        setStartError(errorText(error));
      },
    );
  }, [rpc]);

  useEffect(() => {
    if (!open) {
      startedForOpen.current = false;
      return;
    }
    if (startedForOpen.current) return;
    startedForOpen.current = true;
    start();
  }, [open, start]);

  const current = login !== null && login.id === loginId ? login : null;
  const pendingId = current?.state === "pending" ? current.id : null;

  useEffect(() => {
    if (pendingId === null) return;
    let cancelled = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = () => {
      rpc
        .call("login.poll", { loginId: pendingId })
        .then(
          (result) => {
            failures = 0;
            if (!cancelled) onLogin(result);
          },
          () => {
            failures += 1;
          },
        )
        .finally(() => {
          if (!cancelled) timer = setTimeout(poll, loginPollDelay(failures));
        });
    };
    timer = setTimeout(poll, LOGIN_POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [onLogin, pendingId, rpc]);

  useEffect(() => {
    if (open && current?.state === "signed-in") onOpenChange(false);
  }, [current?.state, onOpenChange, open]);

  const close = useCallback(
    (next: boolean) => {
      if (!next && pendingId !== null) {
        rpc.call("login.cancel", { loginId: pendingId }).then(
          () => {},
          () => {},
        );
      }
      onOpenChange(next);
    },
    [onOpenChange, pendingId, rpc],
  );

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        {open ? (
          <>
            <DialogHeader>
              <DialogTitle>Вход в аккаунт bb</DialogTitle>
              <DialogDescription>
                Подтвердите этот bb на getbb.app. Для входа там используется GitHub.
              </DialogDescription>
            </DialogHeader>
            <SignInDialogBody
              login={current}
              starting={starting}
              startError={startError}
              onRetry={start}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => close(false)}
              >
                Отмена
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function SignedOutContent({
  rpc,
  login,
  onLogin,
  onChanged,
}: {
  rpc: AccountRpc;
  login: LoginView | null;
  onLogin: (state: AccountState) => void;
  onChanged: () => void;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Войдите, чтобы привязать этот bb к аккаунту getbb.app. Он нужен для
        удалённого доступа и облачных сервисов, включая создание названий и сообщений коммитов.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={() => setDialogOpen(true)}>
          Войти
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => setCodeOpen((value) => !value)}
        >
          Есть код привязки?
        </Button>
      </div>
      {codeOpen ? <PairCodeForm rpc={rpc} onDone={onChanged} /> : null}
      <p className="text-xs text-subtle-foreground">
        Через терминал: <span className="font-mono">bb account login</span>
      </p>
      <SignInDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        rpc={rpc}
        login={login}
        onLogin={onLogin}
      />
    </div>
  );
}

function AccountSettingsSection() {
  const rpc = useRpc<typeof accountPrivateRpcContract>();
  const { state, loadError, apply, refetch } = useAccountState();
  const [notice, setNotice] = useState<ReactNode>(null);
  const onSignedOut = useCallback(
    (result: SignOutResult) => {
      setNotice(signOutNotice(result));
      refetch();
    },
    [refetch],
  );

  if (loadError !== null && state === null) {
    return (
      <p className="text-sm text-destructive-text">
        Не удалось загрузить аккаунт bb: {loadError}
      </p>
    );
  }
  if (state === null) {
    return <p className="text-sm text-muted-foreground">Загрузка…</p>;
  }
  if (state.status.state === "signed-in") {
    return (
      <SignedInContent
        account={state.status.account}
        rpc={rpc}
        onSignedOut={onSignedOut}
      />
    );
  }
  if (state.status.state === "profile-pending") {
    return <ProfilePendingContent rpc={rpc} onSignedOut={onSignedOut} />;
  }
  return (
    <div className="space-y-3">
      {notice}
      <SignedOutContent
        rpc={rpc}
        login={state.login}
        onLogin={apply}
        onChanged={() => {
          setNotice(null);
          refetch();
        }}
      />
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.settingsSection({
    id: "account",
    description: "Аккаунт getbb.app, в который вошёл этот bb.",
    component: AccountSettingsSection,
  });
});
