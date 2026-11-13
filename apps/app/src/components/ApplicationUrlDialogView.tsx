import { useState, useSyncExternalStore } from "react";
import { Checkbox } from "@bb/shared-ui/checkbox";
import { Button } from "@bb/shared-ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import {
  getApplicationUrlConfirmation,
  resolveApplicationUrlConfirmation,
  subscribeApplicationUrlConfirmation,
} from "@/lib/application-url";

export function ApplicationUrlDialogView() {
  const confirmation = useSyncExternalStore(
    subscribeApplicationUrlConfirmation,
    getApplicationUrlConfirmation,
  );
  const [rememberedConfirmation, setRememberedConfirmation] =
    useState<typeof confirmation>(null);
  const remember =
    confirmation !== null && rememberedConfirmation === confirmation;
  return (
    <Dialog
      open={confirmation !== null}
      onOpenChange={(open) => {
        if (!open) resolveApplicationUrlConfirmation("cancel");
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Открыть ссылку {confirmation?.target.scheme}?
          </DialogTitle>
          <DialogDescription>
            На этом устройстве откроется приложение.
          </DialogDescription>
        </DialogHeader>
        <p className="break-all text-sm select-text">
          {confirmation?.target.url}
        </p>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={remember}
            onCheckedChange={(checked) =>
              setRememberedConfirmation(checked === true ? confirmation : null)
            }
          />
          Всегда разрешать ссылки {confirmation?.target.scheme} с этого сайта BB
          на этом устройстве
        </label>
        <DialogFooter>
          <Button
            variant="outline"
            autoFocus
            onClick={() => {
              resolveApplicationUrlConfirmation("cancel");
            }}
          >
            Отмена
          </Button>
          <Button
            onClick={() => {
              resolveApplicationUrlConfirmation(remember ? "always" : "open");
            }}
          >
            Открыть
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
