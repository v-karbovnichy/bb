// @vitest-environment jsdom

import type { SystemCliCommandStatus } from "@bb/server-contract";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CliCommandSettingsSectionContent } from "./CliCommandSettingsSection";

afterEach(() => {
  cleanup();
});

const NOT_INSTALLED: SystemCliCommandStatus = {
  installedPath: null,
  onPath: false,
  shadowedBy: null,
  supported: true,
};

function renderSection(
  status: SystemCliCommandStatus,
  pending = false,
): ("install" | "remove")[] {
  const changes: ("install" | "remove")[] = [];
  render(
    <CliCommandSettingsSectionContent
      status={status}
      pending={pending}
      onChange={(change) => changes.push(change)}
    />,
  );
  return changes;
}

function button(name: string): HTMLButtonElement {
  const element = screen.getByRole("button", { name });
  if (!(element instanceof HTMLButtonElement)) {
    throw new Error(`${name} is not a button`);
  }
  return element;
}

describe("CliCommandSettingsSectionContent", () => {
  it("installs the command when it is not on PATH", () => {
    const changes = renderSection(NOT_INSTALLED);

    fireEvent.click(button("Установить bb CLI"));

    expect(changes).toEqual(["install"]);
  });

  it("removes the command it installed and says where it is", () => {
    const changes = renderSection({
      ...NOT_INSTALLED,
      installedPath: "/home/me/.local/bin/bb",
      onPath: true,
    });

    expect(
      screen.getByText(
        "Установлено в /home/me/.local/bin/bb. Управлять bb можно из любого терминала; агенты вне bb, например Claude Code или Codex, тоже смогут им пользоваться.",
      ),
    ).toBeDefined();
    fireEvent.click(button("Удалить bb CLI"));

    expect(changes).toEqual(["remove"]);
  });

  it("says which folder is missing from PATH after installing off PATH", () => {
    renderSection({
      ...NOT_INSTALLED,
      installedPath: "/home/me/.local/bin/bb",
    });

    expect(
      screen.getByText(
        "Установлено в /home/me/.local/bin/bb, но эта папка не входит в PATH. Добавьте её в PATH, чтобы пользоваться bb вне bb.",
      ),
    ).toBeDefined();
  });

  it("does not offer to install behind another bb that runs first", () => {
    renderSection({
      ...NOT_INSTALLED,
      shadowedBy: { path: "/usr/local/bin/bb", source: "other" },
    });

    expect(button("Установить bb CLI").disabled).toBe(true);
    expect(
      screen.getByText(
        "В PATH раньше находится другая установка bb: /usr/local/bin/bb. Удалите её, чтобы установить эту версию.",
      ),
    ).toBeDefined();
  });

  it("recognises a bb that npm already put on PATH", () => {
    renderSection({
      ...NOT_INSTALLED,
      shadowedBy: { path: "/usr/local/bin/bb", source: "npm" },
    });

    expect(button("Установить bb CLI").disabled).toBe(true);
    expect(
      screen.getByText(
        "Уже установлено для работы вне bb через npm по пути /usr/local/bin/bb.",
      ),
    ).toBeDefined();
  });

  it("blocks a second change while one is running", () => {
    renderSection(NOT_INSTALLED, true);

    expect(button("Установить bb CLI").disabled).toBe(true);
  });
});
