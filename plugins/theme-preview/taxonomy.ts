export type AreaId = "mock" | "overlays" | "components" | "stylesheet";

export const AREA_TITLES: Record<AreaId, string> = {
  mock: "Предпросмотр",
  overlays: "Всплывающие элементы",
  components: "Компоненты",
  stylesheet: "Стили",
};

export const MOCK_VIEWS = [
  { id: "thread", label: "Чат", exercises: "состояния строк боковой панели, всплывающее содержание, сообщения, границы, изменения файлов, панель сведений, индикаторы проверки и поле ввода" },
  { id: "new", label: "Новый чат", exercises: "наведение на строку боковой панели, пустой экран и активное поле ввода" },
  { id: "split", label: "Разделение", exercises: "разделитель панелей, активная и неактивная панели и две разные переписки" },
  { id: "settings", label: "Настройки", exercises: "навигация по настройкам, раздел оформления, подписи и описания, элементы управления и переключатель темы" },
] as const;

export const COLOR_GROUPS = [
  {
    id: "surfaces",
    title: "Поверхности",
    band: "palette",
    contrast: "none",
    tokens: ["canvas", "sidebar", "card", "popover", "secondary", "muted", "surface-recessed-solid", "surface-scrim"],
  },
  {
    id: "ink",
    title: "Текст",
    band: "palette",
    contrast: "vs-surface",
    tokens: ["ink", "foreground", "muted-foreground", "subtle-foreground", "readback-foreground", "sidebar-foreground"],
  },
  {
    id: "accent",
    title: "Акцент",
    band: "palette",
    contrast: "none",
    tokens: ["primary", "file-accent", "timeline-accent", "surface-selected", "state-hover", "state-active"],
  },
  {
    id: "status",
    title: "Состояния",
    band: "palette",
    contrast: "as-painted",
    tokens: ["success", "warning", "attention", "destructive", "pr-merged", "diff-added", "diff-removed"],
  },
  {
    id: "lines",
    title: "Линии",
    band: "foundation",
    contrast: "none",
    tokens: ["border", "border-hairline", "border-seam", "sidebar-border", "input", "ring"],
  },
] as const;

export const TYPE_SPECIMENS = [
  { id: "font-sans", title: "Без засечек", token: "font-sans" },
  { id: "font-mono", title: "Моноширинный", token: "font-mono" },
  { id: "text-scale", title: "Размер текста", token: "text-sm" },
  { id: "line-height", title: "Межстрочный интервал", token: "text-sm--line-height" },
] as const;

export const RHYTHM_SPECIMENS = [
  { id: "density", title: "Плотность", token: "spacing", unit: "px" },
  { id: "tracking", title: "Межбуквенный интервал", token: "tracking-normal", unit: "em" },
  { id: "row-height", title: "Строка боковой панели", token: "bb-sidebar-row-height", unit: "px" },
  { id: "icon-stroke", title: "Толщина значка", token: "icon-stroke-width", unit: "" },
] as const;

export const RADIUS_SPECIMENS = [
  { id: "radius", title: "Базовый", source: "var(--radius)" },
  { id: "radius-sm", title: "Малый", source: "calc(var(--radius) - 4px)" },
  { id: "radius-md", title: "Средний", source: "calc(var(--radius) - 2px)" },
  { id: "radius-lg", title: "Большой", source: "var(--radius)" },
  { id: "radius-xl", title: "Очень большой", source: "calc(var(--radius) + 4px)" },
] as const;

export const SHADOW_SPECIMENS = [
  { id: "y", title: "Y", token: "shadow-y" },
  { id: "blur", title: "Размытие", token: "shadow-blur" },
  { id: "x", title: "X", token: "shadow-x" },
  { id: "spread", title: "Распространение", token: "shadow-spread" },
  { id: "color", title: "Цвет", token: "tp-shadow-color" },
  { id: "opacity", title: "Непрозрачность", token: "tp-shadow-opacity-percent" },
] as const;
