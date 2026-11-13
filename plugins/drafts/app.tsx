import { toast } from "sonner";
import {
  definePluginApp,
  type ComposerSendMenuItem,
} from "@get-bb/plugin-sdk/app";

const saveDraft: ComposerSendMenuItem = {
  id: "drafts",
  label: "Сохранить черновик…",
  icon: "EditFile",
  description: "Сохранить сообщение в очереди до отправки вручную.",
  disabled: (composer) => composer.isSubmittingBlocked,
  run: async ({ composer }) => {
    if (composer.isEmpty) {
      toast.error("Нечего сохранять", {
        description: "Сначала введите сообщение, затем сохраните его как черновик.",
      });
      return;
    }
    try {
      await composer.submit({
        experimental_mode: "queue-if-active",
        experimental_data: { kind: "draft" },
      });
      toast.success("Черновик сохранён");
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  },
};

export default definePluginApp((app) => {
  app.composer.customize({
    id: "drafts",
    scopes: ["thread", "new-thread"],
    sendMenu: [saveDraft],
  });
});
