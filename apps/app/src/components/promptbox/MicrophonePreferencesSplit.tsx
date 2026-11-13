import { PickerLoadingRows } from "@/components/pickers/PickerLoadingRows";
import { defineSplit } from "@/lib/define-split";

export const MicrophonePreferencesSplit = defineSplit<{
  open: boolean;
  onCaptureReady?: () => void;
}>({
  id: "microphone-preferences",
  load: () =>
    import("./MicrophonePreferences").then(
      (module) => module.MicrophonePreferences,
    ),
  loading: () => (
    <PickerLoadingRows
      label="Загрузка микрофонов"
      rowDataAttribute="data-microphone-loading-row"
    />
  ),
  tier: "intent",
});
