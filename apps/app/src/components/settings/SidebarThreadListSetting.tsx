import { threadListProviderAtom } from "@/components/sidebar/threadListProvider";
import { usePluginSlots } from "@/lib/plugin-slots";
import { ReplacementProviderSetting } from "./ReplacementProviderSetting";

export function SidebarThreadListSetting() {
  const { threadLists } = usePluginSlots();
  return (
    <ReplacementProviderSetting
      label="Список чатов в боковой панели"
      triggerAriaLabel="Список чатов в боковой панели"
      description="Какой плагин отображает чаты в боковой панели."
      preferenceAtom={threadListProviderAtom}
      slots={threadLists}
    />
  );
}
