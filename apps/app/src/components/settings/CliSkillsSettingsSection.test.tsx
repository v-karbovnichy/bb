// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  CliSkillsSettingsSectionContent,
  summarizeMachineStatuses,
} from "./CliSkillsSettingsSection";

afterEach(() => {
  cleanup();
});

function installButton(): HTMLButtonElement {
  const button = screen.getByRole("button", { name: "Установить Навыки CLI bb" });
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error("Install control is not a button");
  }
  return button;
}

describe("CliSkillsSettingsSectionContent", () => {
  it("offers the picker when a machine is connected", () => {
    render(
      <CliSkillsSettingsSectionContent
        hasConnectedMachine={true}
        onOpenPicker={() => undefined}
        pending={false}
        statusBadge={null}
      />,
    );

    expect(installButton().disabled).toBe(false);
  });

  it("explains why the install is unavailable with no connected machine", () => {
    render(
      <CliSkillsSettingsSectionContent
        hasConnectedMachine={false}
        onOpenPicker={() => undefined}
        pending={false}
        statusBadge={null}
      />,
    );

    expect(installButton().disabled).toBe(true);
    expect(
      screen.getByText(
        "Подключите машину, чтобы установить их в ~/.agents/skills и ~/.claude/skills.",
      ),
    ).toBeDefined();
  });

  it("blocks reopening the picker while an install is running", () => {
    render(
      <CliSkillsSettingsSectionContent
        hasConnectedMachine={true}
        onOpenPicker={() => undefined}
        pending={true}
        statusBadge="Установлено"
      />,
    );

    expect(installButton().disabled).toBe(true);
    expect(installButton().textContent).toBe("Установка…");
  });
});

describe("summarizeMachineStatuses", () => {
  it("reports a single machine plainly", () => {
    expect(summarizeMachineStatuses(["installed"])).toBe("Установлено");
    expect(summarizeMachineStatuses(["outdated"])).toBe("Устарели");
    expect(summarizeMachineStatuses(["missing"])).toBe("Не установлены");
  });

  it("counts a mixed fleet instead of claiming either extreme", () => {
    expect(summarizeMachineStatuses(["installed", "outdated", "missing"])).toBe(
      "Установлено на 1 из 3 машин",
    );
    expect(summarizeMachineStatuses(["installed", "installed"])).toBe(
      "Установлено на машинах (2)",
    );
  });

  it("ignores machines it could not ask, and shows nothing if that is all of them", () => {
    expect(summarizeMachineStatuses(["installed", "unknown"])).toBe(
      "Установлено",
    );
    expect(summarizeMachineStatuses(["unknown", "unknown"])).toBe(null);
    expect(summarizeMachineStatuses([])).toBe(null);
  });
});
