// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { installTestPluginRuntime } from "@get-bb/plugin-sdk/testing/app";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { makeWorkspaceMergeBase, makeWorkspaceStatus } from "../../testing.js";
import { formatBranchComparison, GitStatusRowView } from "./GitInfoRows.js";

installTestPluginRuntime();

function renderRow(
  props: Parameters<typeof GitStatusRowView>[0],
): string {
  return renderToStaticMarkup(
    <TooltipProvider>
      <GitStatusRowView {...props} />
    </TooltipProvider>,
  );
}

describe("GitStatusRowView", () => {
  it("qualifies counts when squash detection is incomplete", () => {
    const markup = renderRow({
      workspace: makeWorkspaceStatus({
        mergeBase: makeWorkspaceMergeBase({
          aheadCount: 3,
          squashMergeCheckComplete: false,
        }),
      }),
      failure: undefined,
      errorMessage: null,
    });
    expect(markup).toContain("Впереди main на 3");
    expect(markup).toContain(
      'aria-label="Проверка объединения со сжатием не завершена; в количестве могут учитываться уже объединённые коммиты."',
    );
  });

  it("compares the branch with the merge base the host reported", () => {
    const render = (
      mergeBase: ReturnType<typeof makeWorkspaceMergeBase> | null,
    ) =>
      renderRow({
        workspace: makeWorkspaceStatus({ mergeBase }),
        failure: undefined,
        errorMessage: null,
      });
    expect(
      render(
        makeWorkspaceMergeBase({ mergeBaseBranch: "release", aheadCount: 2 }),
      ),
    ).toContain("Впереди release на 2");
    expect(render(null)).toBe("");
  });

  it("keeps the last known comparison when a refresh fails and flags it as stale", () => {
    const render = (errorMessage: string | null) =>
      renderRow({
        workspace: makeWorkspaceStatus({
          mergeBase: makeWorkspaceMergeBase({
            mergeBaseBranch: "main",
            aheadCount: 3,
          }),
        }),
        failure: undefined,
        errorMessage,
      });
    const stale = render("Статус рабочей копии недоступен.");
    expect(stale).toContain("Впереди main на 3");
    expect(stale).toContain(
      "Не удалось обновить: Статус рабочей копии недоступен. Показан последний известный статус.",
    );
    expect(render(null)).not.toContain("Не удалось обновить");
  });

  it("shows the failure when no status has loaded", () => {
    expect(
      renderRow({
        workspace: undefined,
        failure: undefined,
        errorMessage: "Статус рабочей копии недоступен.",
      }),
    ).toContain("Статус рабочей копии недоступен");
    expect(
      renderRow({
        workspace: undefined,
        failure: {
          code: "path_not_found",
          workspacePath: "/tmp/workspace",
          message: "No such directory",
        },
        errorMessage: null,
      }),
    ).toContain("Рабочая копия не найдена");
    expect(
      renderRow({ workspace: undefined, failure: undefined, errorMessage: null }),
    ).toBe("");
  });

  it("phrases the branch comparison against its merge base", () => {
    const compare = (aheadCount: number, behindCount: number) =>
      formatBranchComparison({ aheadCount, behindCount, baseBranch: "main" });
    expect(compare(0, 0)).toBe("На одном уровне с main");
    expect(compare(6, 0)).toBe("Впереди main на 6");
    expect(compare(0, 3)).toBe("Позади main на 3");
    expect(compare(4, 2)).toBe("Впереди на 4, позади main на 2");
  });
});
