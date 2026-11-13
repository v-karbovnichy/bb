import { useEffect, useRef, useState } from "react";
import type { BbDesktopBrowserApi } from "@bb/desktop-contract";
import {
  DESKTOP_BROWSER_IMPORT_FAILURE_COPY,
  isRetryableDesktopBrowserImportReason,
  type DesktopBrowserImportOutcome,
  type DesktopBrowserImportSource,
} from "@bb/host-daemon-contract";
import { Button } from "@bb/shared-ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import { cn } from "@bb/shared-ui/lib/utils";
import { BrowserSourceIcon } from "./BrowserSourceIcon";
import {
  canCloseDialog,
  failedDialogStep,
  formatCookieCount,
  initialDialogStep,
  preferredSourceProfileDirectory,
  refreshedDialogStep,
  type BrowserImportDialogStep,
} from "./browser-import-wizard";

export interface BrowserImportDialogProps {
  source: DesktopBrowserImportSource;
  desktopBrowser: BbDesktopBrowserApi;
  onClose: () => void;
  onImported: (
    source: DesktopBrowserImportSource,
    profileName: string,
    outcome: DesktopBrowserImportOutcome & { ok: true },
  ) => void;
}

const TILE_CLASS =
  "flex w-full items-center gap-2.5 rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-state-hover";
const TILE_SELECTED_CLASS =
  "border-surface-selected-border bg-surface-selected";
const TILE_IDLE_CLASS = "border-border";

export function BrowserImportDialog({
  source: initialSource,
  desktopBrowser,
  onClose,
  onImported,
}: BrowserImportDialogProps) {
  const [source, setSource] = useState(initialSource);
  const [step, setStep] = useState<BrowserImportDialogStep>(() =>
    initialDialogStep(initialSource),
  );
  const [sourceProfileDirectory, setSourceProfileDirectory] = useState<
    string | null
  >(() => preferredSourceProfileDirectory(null, initialSource));
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const selectedProfile = source.profiles.find(
    (profile) => profile.directory === sourceProfileDirectory,
  );

  const runImport = () => {
    if (
      sourceProfileDirectory === null ||
      selectedProfile === undefined ||
      !desktopBrowser.importCookies
    ) {
      setStep({ step: "blocked", reason: "unknownSourceProfile" });
      return;
    }
    const profileName = selectedProfile.name;
    setStep({ step: "importing" });
    desktopBrowser
      .importCookies({
        sourceId: source.id,
        sourceProfileDirectory,
      })
      .then((outcome) => {
        if (!mounted.current) return;
        if (outcome.ok) {
          onImported(source, profileName, outcome);
          onClose();
          return;
        }
        setStep(failedDialogStep(outcome.reason));
      })
      .catch(() => {
        if (mounted.current) setStep({ step: "blocked", reason: "readFailed" });
      });
  };

  const recheck = () => {
    if (!desktopBrowser.listImportSources) return;
    const previous = step;
    setStep({ step: "checking" });
    desktopBrowser
      .listImportSources()
      .then((result) => {
        if (!mounted.current) return;
        const refreshed = result.sources.find(
          (candidate) => candidate.id === source.id,
        );
        if (refreshed) {
          setSource(refreshed);
          setSourceProfileDirectory((current) =>
            preferredSourceProfileDirectory(current, refreshed),
          );
        }
        setStep(refreshedDialogStep(refreshed, previous));
      })
      .catch(() => {
        if (mounted.current) setStep({ step: "blocked", reason: "readFailed" });
      });
  };

  const closable = canCloseDialog(step);
  const title = (text: string) => (
    <DialogTitle className="flex items-center gap-2.5">
      <BrowserSourceIcon source={source} className="size-5 rounded-[5px]" />
      {text}
    </DialogTitle>
  );

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && closable) onClose();
      }}
    >
      <DialogContent
        hideCloseButton={!closable}
        onEscapeKeyDown={(event) => {
          if (!closable) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (!closable) event.preventDefault();
        }}
      >
        {step.step === "fullDiskAccess" ? (
          <>
            <DialogHeader>
              {title(`Разрешите полный доступ к диску для ${source.name}`)}
              <DialogDescription>
                {source.name} хранит файлы cookie в защищённой папке. Включите
                полный доступ к диску для BB в Системных настройках →
                Конфиденциальность и безопасность, затем вернитесь сюда. После
                импорта доступ можно отключить.
              </DialogDescription>
            </DialogHeader>
            {step.checked ? (
              <p className="text-xs text-destructive-text">
                Полный доступ к диску всё ещё выключен. Возможно, потребуется
                закрыть и снова открыть BB, чтобы macOS применила разрешение.
              </p>
            ) : null}
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                Отмена
              </Button>
              {desktopBrowser.openFullDiskAccessSettings ? (
                <Button
                  variant="outline"
                  onClick={() => desktopBrowser.openFullDiskAccessSettings?.()}
                >
                  Открыть системные настройки
                </Button>
              ) : null}
              <Button onClick={recheck}>Я включил доступ</Button>
            </DialogFooter>
          </>
        ) : step.step === "checking" ? (
          <DialogHeader>
            {title(`Проверка ${source.name}…`)}
            <DialogDescription>Это займёт всего минуту.</DialogDescription>
          </DialogHeader>
        ) : step.step === "importing" ? (
          <DialogHeader>
            {title(`Импорт из ${source.name}…`)}
            <DialogDescription>
              Чтение и расшифровка файлов cookie. macOS может запросить доступ к связке ключей.
            </DialogDescription>
          </DialogHeader>
        ) : step.step === "blocked" ? (
          <>
            <DialogHeader>
              {title(`Не удалось импортировать из ${source.name}`)}
              <DialogDescription>
                {DESKTOP_BROWSER_IMPORT_FAILURE_COPY[step.reason]}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                Закрыть
              </Button>
              {isRetryableDesktopBrowserImportReason(step.reason) ? (
                <Button onClick={recheck}>
                  {step.reason === "browserRunning"
                    ? "Я закрыл браузер"
                    : "Повторить"}
                </Button>
              ) : null}
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              {title(`Импорт из ${source.name}`)}
              <DialogDescription>
                Из какого профиля скопировать файлы cookie в браузер BB?
              </DialogDescription>
            </DialogHeader>
            <div
              role="radiogroup"
              aria-label="Исходный профиль"
              className="flex flex-col gap-1.5"
            >
              {source.profiles.map((profile) => {
                const selected = profile.directory === sourceProfileDirectory;
                return (
                  <button
                    key={profile.directory}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    className={cn(
                      TILE_CLASS,
                      selected ? TILE_SELECTED_CLASS : TILE_IDLE_CLASS,
                    )}
                    onClick={() => setSourceProfileDirectory(profile.directory)}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "flex size-3.5 shrink-0 items-center justify-center rounded-full border",
                        selected ? "border-foreground" : "border-border",
                      )}
                    >
                      {selected ? (
                        <span className="size-1.5 rounded-full bg-foreground" />
                      ) : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-foreground">
                        {profile.name}
                      </span>
                      {profile.cookieCount !== undefined ? (
                        <span className="block text-xs text-subtle-foreground">
                          {formatCookieCount(profile.cookieCount)}
                        </span>
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-subtle-foreground">
              Во время импорта {source.name} должен быть закрыт. macOS может
              запросить доступ к ключу шифрования в связке ключей; нажмите «Разрешить».
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                Отмена
              </Button>
              <Button
                onClick={runImport}
                disabled={sourceProfileDirectory === null}
              >
                {selectedProfile?.cookieCount !== undefined
                  ? `Импортировать · ${formatCookieCount(selectedProfile.cookieCount)}`
                  : "Импортировать"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
