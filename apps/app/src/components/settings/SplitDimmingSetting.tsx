import { Switch } from "@bb/shared-ui/switch";
import { useAtom } from "jotai";
import { SettingsWithControl } from "@/components/ui/settings-section";
import { dimInactiveSplitsAtom } from "@/lib/split-layout/atoms";

const SPLIT_DIMMING_SETTING_LABEL = "Затемнять неактивные области";

export function SplitDimmingSetting() {
  const [dimsInactiveSplits, setDimsInactiveSplits] = useAtom(
    dimInactiveSplitsAtom,
  );

  return (
    <SettingsWithControl
      label={SPLIT_DIMMING_SETTING_LABEL}
      description="Затемнять области без фокуса."
    >
      <Switch
        checked={dimsInactiveSplits}
        onCheckedChange={setDimsInactiveSplits}
        aria-label={SPLIT_DIMMING_SETTING_LABEL}
      />
    </SettingsWithControl>
  );
}
