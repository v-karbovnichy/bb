import type { IconName } from "@bb/shared-ui/icon";
import { SETTINGS_ROUTE_PATH, getSettingsRoutePath } from "@/lib/route-paths";

export const SETTINGS_NAV_SECTIONS = [
  { icon: "Settings", id: "general", label: "Основные" },
  { icon: "Bot", id: "providers", label: "Провайдеры" },
  { icon: "AiBrain01", id: "ai-services", label: "Сервисы ИИ" },
  { icon: "Palette", id: "appearance", label: "Внешний вид" },
  { icon: "SlidersHorizontal", id: "keyboard", label: "Клавиатура" },
  { icon: "Browser", id: "browser", label: "Браузер" },
  { icon: "File", id: "files", label: "Файлы" },
  { icon: "FolderGit", id: "projects", label: "Проекты" },
  { icon: "Laptop", id: "machines", label: "Машины" },
  { icon: "Smartphone", id: "mobile", label: "Мобильные приложения" },
  {
    icon: "Lock",
    id: "environment-variables",
    label: "Переменные окружения",
  },
  { icon: "PackageReceive", id: "updates", label: "Обновления" },
  { icon: "Plug02", id: "plugins", label: "Установленные плагины" },
  { icon: "Puzzle", id: "marketplaces", label: "Маркетплейсы плагинов" },
  { icon: "Beaker", id: "experiments", label: "Эксперименты" },
  { icon: "MessageSquare", id: "community", label: "Сообщество" },
  { icon: "Archive", id: "archived", label: "Архивные чаты" },
] as const satisfies readonly {
  icon: IconName;
  id: string;
  label: string;
}[];

export type SettingsNavSection = (typeof SETTINGS_NAV_SECTIONS)[number];

export type SettingsSectionId = SettingsNavSection["id"];

export function isSettingsSectionId(value: string): value is SettingsSectionId {
  return SETTINGS_NAV_SECTIONS.some((section) => section.id === value);
}

export function getSettingsSectionRoutePath(
  sectionId: SettingsSectionId,
): string {
  return sectionId === "general"
    ? SETTINGS_ROUTE_PATH
    : getSettingsRoutePath(sectionId);
}
