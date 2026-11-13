// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { ProviderCliBanner } from "./ProviderCliBanner";

afterEach(() => {
  cleanup();
});

function renderBanner(
  props: Omit<ComponentProps<typeof ProviderCliBanner>, "onAction">,
) {
  render(<ProviderCliBanner {...props} onAction={() => {}} />);
  return {
    text: screen.getByRole("alert").textContent,
    button: screen.getByRole("button"),
  };
}

describe("ProviderCliBanner", () => {
  it("uses the selected provider's identity and update requirement", () => {
    const { text, button } = renderBanner({
      displayName: "Example Agent",
      installed: true,
      currentVersion: "0.135.0",
      minimumSupportedVersion: "0.136.0",
      canRunAction: true,
      actionRunning: false,
    });

    expect(
      screen.getByRole("region", { name: "Требуется обновить Example Agent" }),
    ).toBeTruthy();
    expect(text).toContain(
      "Обновите Example Agent, прежде чем создавать чат. Установлена версия 0.135.0; требуется версия 0.136.0 или новее.",
    );
    expect(button.textContent).toBe("Обновить Example Agent");
    expect(button.hasAttribute("disabled")).toBe(false);
  });

  it("shows update progress without repeating an ambiguous version fallback", () => {
    const { text, button } = renderBanner({
      displayName: "Codex",
      installed: true,
      currentVersion: "0.135.0",
      minimumSupportedVersion: null,
      canRunAction: true,
      actionRunning: true,
    });

    expect(text).toContain("Установлена версия 0.135.0; требуется более новая версия.");
    expect(button.textContent).toContain("Обновление…");
    expect(button.hasAttribute("disabled")).toBe(true);
  });

  it("asks for an install instead of a version when the CLI is missing", () => {
    const { text, button } = renderBanner({
      displayName: "Claude Code",
      installed: false,
      currentVersion: null,
      minimumSupportedVersion: "2.1.0",
      canRunAction: true,
      actionRunning: false,
    });

    expect(
      screen.getByRole("region", { name: "Claude Code не установлен" }),
    ).toBeTruthy();
    expect(text).toContain("Установите Claude Code, прежде чем создавать чат.");
    expect(text).not.toContain("версия");
    expect(button.textContent).toBe("Установить Claude Code");
  });
});
