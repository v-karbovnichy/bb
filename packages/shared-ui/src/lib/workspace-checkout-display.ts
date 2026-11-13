import type { GitCheckoutRef } from "@bb/domain";

const SHORT_SHA_LENGTH = 7;

export interface WorkspaceCheckoutDisplay {
  copyErrorMessage: string | null;
  copyLabel: string | null;
  copySuccessMessage: string | null;
  copyValue: string | null;
  label: string;
  rowLabel: "Ветка" | "Рабочая копия";
  title: string;
}

interface FormatWorkspaceCheckoutDisplayArgs {
  checkout: GitCheckoutRef;
}

function shortSha(sha: string): string {
  return sha.slice(0, SHORT_SHA_LENGTH);
}

export function formatWorkspaceCheckoutDisplay({
  checkout,
}: FormatWorkspaceCheckoutDisplayArgs): WorkspaceCheckoutDisplay {
  switch (checkout.kind) {
    case "branch":
      return {
        copyErrorMessage: "Не удалось скопировать название ветки",
        copyLabel: "Скопировать название ветки",
        copySuccessMessage: "Название ветки скопировано",
        copyValue: checkout.branchName,
        label: checkout.branchName,
        rowLabel: "Ветка",
        title: `Скопировать название ветки: ${checkout.branchName}`,
      };
    case "detached":
      if (checkout.headSha === null) {
        return {
          copyErrorMessage: null,
          copyLabel: null,
          copySuccessMessage: null,
          copyValue: null,
          label: "отсоединённый HEAD",
          rowLabel: "Рабочая копия",
          title: "Отсоединённый HEAD",
        };
      }
      return {
        copyErrorMessage: "Не удалось скопировать SHA коммита",
        copyLabel: "Скопировать SHA коммита",
        copySuccessMessage: "SHA коммита скопирован",
        copyValue: checkout.headSha,
        label: `отсоединённый ${shortSha(checkout.headSha)}`,
        rowLabel: "Рабочая копия",
        title: `Отсоединённый HEAD: ${checkout.headSha}`,
      };
    case "unborn":
      return {
        copyErrorMessage: null,
        copyLabel: null,
        copySuccessMessage: null,
        copyValue: null,
        label:
          checkout.branchName !== null
            ? `${checkout.branchName} (пустая)`
            : "пустой репозиторий",
        rowLabel: "Рабочая копия",
        title:
          checkout.branchName !== null
            ? `Пустая ветка: ${checkout.branchName}`
            : "Пустой репозиторий",
      };
    case "unknown":
      return {
        copyErrorMessage: null,
        copyLabel: null,
        copySuccessMessage: null,
        copyValue: null,
        label: "неизвестная рабочая копия",
        rowLabel: "Рабочая копия",
        title: `Неизвестная рабочая копия: ${checkout.reason}`,
      };
  }
}
