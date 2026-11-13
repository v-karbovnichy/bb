import { describe, expect, it } from "vitest";
import { formatWorkspaceCheckoutDisplay } from "./workspace-checkout-display";

describe("formatWorkspaceCheckoutDisplay", () => {
  it("formats a branch checkout as a copyable branch label", () => {
    expect(
      formatWorkspaceCheckoutDisplay({
        checkout: {
          kind: "branch",
          branchName: "bb/thread",
          headSha: "1234567890abcdef",
        },
      }),
    ).toMatchObject({
      copyValue: "bb/thread",
      label: "bb/thread",
      rowLabel: "Ветка",
      title: "Скопировать название ветки: bb/thread",
    });
  });

  it("formats detached HEAD with a short SHA label and copyable full SHA", () => {
    expect(
      formatWorkspaceCheckoutDisplay({
        checkout: {
          kind: "detached",
          headSha: "abcdef1234567890",
        },
      }),
    ).toMatchObject({
      copyValue: "abcdef1234567890",
      label: "отсоединённый abcdef1",
      rowLabel: "Рабочая копия",
      title: "Отсоединённый HEAD: abcdef1234567890",
    });
  });

  it("formats detached HEAD without a SHA", () => {
    expect(
      formatWorkspaceCheckoutDisplay({
        checkout: {
          kind: "detached",
          headSha: null,
        },
      }),
    ).toMatchObject({
      copyValue: null,
      label: "отсоединённый HEAD",
      rowLabel: "Рабочая копия",
      title: "Отсоединённый HEAD",
    });
  });

  it("formats an unborn checkout with a branch name", () => {
    expect(
      formatWorkspaceCheckoutDisplay({
        checkout: {
          kind: "unborn",
          branchName: "main",
        },
      }),
    ).toMatchObject({
      copyValue: null,
      label: "main (пустая)",
      rowLabel: "Рабочая копия",
      title: "Пустая ветка: main",
    });
  });

  it("formats an unborn checkout without a branch name", () => {
    expect(
      formatWorkspaceCheckoutDisplay({
        checkout: {
          kind: "unborn",
          branchName: null,
        },
      }),
    ).toMatchObject({
      copyValue: null,
      label: "пустой репозиторий",
      rowLabel: "Рабочая копия",
      title: "Пустой репозиторий",
    });
  });

  it("formats an unknown checkout", () => {
    expect(
      formatWorkspaceCheckoutDisplay({
        checkout: {
          kind: "unknown",
          reason: "HEAD is missing",
        },
      }),
    ).toMatchObject({
      copyValue: null,
      label: "неизвестная рабочая копия",
      rowLabel: "Рабочая копия",
      title: "Неизвестная рабочая копия: HEAD is missing",
    });
  });
});
