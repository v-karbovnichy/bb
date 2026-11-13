export interface ComposerSubmitGateInput {
  canSubmit: boolean;
  hasSubmittableInput: boolean;
  isAttaching: boolean;
  isSubmitting: boolean;
  voiceActive: boolean;
  submitDisabledReason: string | undefined;
}

export function composerSubmittingBlockedReason({
  canSubmit,
  hasSubmittableInput,
  isAttaching,
  isSubmitting,
  voiceActive,
  submitDisabledReason,
}: ComposerSubmitGateInput): string | null {
  if (canSubmit) return null;
  if (isAttaching) return "Загрузка вложений...";
  if (submitDisabledReason !== undefined) return submitDisabledReason;
  if (voiceActive) return "Сначала завершите голосовой ввод.";
  if (isSubmitting) return "Отправка...";
  return hasSubmittableInput
    ? "Сейчас не удаётся отправить сообщение."
    : "Сначала введите сообщение.";
}

export function hasSubmittableComposerInput(draft: {
  text: string;
  attachments: readonly unknown[];
}): boolean {
  return draft.text.trim().length > 0 || draft.attachments.length > 0;
}
