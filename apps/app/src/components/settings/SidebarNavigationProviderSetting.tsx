import { sidebarNavigationProviderAtom } from "@/components/sidebar/sidebarNavigationProvider";
import { usePluginSlots } from "@/lib/plugin-slots";
import { ReplacementProviderSetting } from "./ReplacementProviderSetting";

export function SidebarNavigationProviderSetting() {
  const { experimentalSidebarNavigations } = usePluginSlots();
  return (
    <ReplacementProviderSetting
      label="Навигация"
      triggerAriaLabel="Навигация боковой панели"
      description="Что отображает в боковой панели новый чат, плагины, навыки и страницы плагинов."
      preferenceAtom={sidebarNavigationProviderAtom}
      slots={experimentalSidebarNavigations}
    />
  );
}
