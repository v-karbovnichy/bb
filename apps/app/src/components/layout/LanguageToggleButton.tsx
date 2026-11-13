import { useLingui } from "@lingui/react/macro";
import { Button } from "@bb/shared-ui/button";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import { useUpdateGeneralSettings } from "@/hooks/mutations/settings-mutations";

export function LanguageToggleButton() {
  const { t } = useLingui();
  const { data: systemConfig } = useSystemConfig();
  const updateGeneralSettings = useUpdateGeneralSettings();
  const language = systemConfig?.generalSettings.language ?? "en";
  const nextLanguage = language === "en" ? "ru" : "en";
  const label =
    nextLanguage === "ru"
      ? t`Switch interface to Russian`
      : t`Switch interface to English`;

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-8 shrink-0 text-xs"
      aria-label={label}
      disabled={systemConfig === undefined || updateGeneralSettings.isPending}
      onClick={() => updateGeneralSettings.mutate({ language: nextLanguage })}
    >
      {nextLanguage === "ru" ? "RU" : "EN"}
    </Button>
  );
}
