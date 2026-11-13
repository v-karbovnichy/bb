import type { PermissionMode } from "@bb/domain";

export interface PermissionModeOption {
  value: PermissionMode;
  label: string;
  description: string;
  tone?: "warning";
}

export const PERMISSION_MODE_OPTIONS: PermissionModeOption[] = [
  {
    value: "accept-edits",
    label: "Принимать изменения",
    description:
      "Изменения в рабочей папке применяются автоматически. Для действий за её пределами потребуется ваше подтверждение.",
  },
  {
    value: "auto",
    label: "Подтверждать за меня",
    description:
      "Запросы в рабочей папке проверяются автоматически. Действия с высоким риском всё ещё могут потребовать вашего подтверждения.",
  },
  {
    value: "full",
    label: "Полный доступ",
    tone: "warning",
    description:
      "Без изоляции и подтверждений — агент может выполнять любые действия на вашем компьютере.",
  },
];
