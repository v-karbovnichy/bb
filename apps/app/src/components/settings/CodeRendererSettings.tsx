import { composerRendererProviderAtom } from "@/components/promptbox/composer-provider";
import {
  diffRendererProviderAtom,
  sourceCodeRendererProviderAtom,
} from "@/components/code/codeRendererProvider";
import { usePluginSlots } from "@/lib/plugin-slots";
import { ReplacementProviderSetting } from "./ReplacementProviderSetting";

export function CodeRendererSettings() {
  const { sourceCodeRenderers, diffRenderers, composers } = usePluginSlots();
  return (
    <>
      <ReplacementProviderSetting
        label="Исходный код"
        triggerAriaLabel="Исходный код"
        description="Выберите автоматический режим, просмотрщик BB или конкретный плагин на этом устройстве."
        builtInDescription="Подсветка синтаксиса и поля из темы кода bb."
        preferenceAtom={sourceCodeRendererProviderAtom}
        slots={sourceCodeRenderers}
      />
      <ReplacementProviderSetting
        label="Изменения"
        triggerAriaLabel="Изменения"
        description="Применяется к изменениям файлов в чатах, панели изменений и представлениях плагинов."
        builtInDescription="Единый и разделённый просмотр изменений в теме кода bb."
        preferenceAtom={diffRendererProviderAtom}
        slots={diffRenderers}
      />
      <ReplacementProviderSetting
        label="Поле ввода"
        triggerAriaLabel="Поле ввода"
        description="Поле запроса в чатах, на экране нового чата и в редакторах сообщений."
        preferenceAtom={composerRendererProviderAtom}
        slots={composers}
      />
    </>
  );
}
