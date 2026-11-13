// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "@lingui/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { activateLanguage, i18n } from "@/i18n/i18n";
import { LanguageToggleButton } from "./LanguageToggleButton";

const state = vi.hoisted(() => ({
  language: "en" as "en" | "ru",
  pending: false,
  mutate: vi.fn(),
}));

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({
    data: { generalSettings: { language: state.language } },
  }),
}));

vi.mock("@/hooks/mutations/settings-mutations", () => ({
  useUpdateGeneralSettings: () => ({
    isPending: state.pending,
    mutate: state.mutate,
  }),
}));

afterEach(async () => {
  cleanup();
  state.language = "en";
  state.pending = false;
  state.mutate.mockReset();
  await activateLanguage("en");
});

function renderButton() {
  return render(
    <I18nProvider i18n={i18n}>
      <LanguageToggleButton />
    </I18nProvider>,
  );
}

describe("LanguageToggleButton", () => {
  it("switches from English to Russian through the persisted setting", () => {
    renderButton();
    const button = screen.getByRole("button", {
      name: "Switch interface to Russian",
    });
    expect(button.textContent).toBe("RU");
    fireEvent.click(button);
    expect(state.mutate).toHaveBeenCalledWith({ language: "ru" });
  });

  it("offers English when Russian is active", async () => {
    state.language = "ru";
    await activateLanguage("ru");
    renderButton();
    const button = screen.getByRole("button", {
      name: "Переключить интерфейс на английский",
    });
    expect(button.textContent).toBe("EN");
    fireEvent.click(button);
    expect(state.mutate).toHaveBeenCalledWith({ language: "en" });
  });

  it("blocks another switch while the setting is being saved", () => {
    state.pending = true;
    renderButton();
    expect(
      screen.getByRole("button", { name: "Switch interface to Russian" })
        .hasAttribute("disabled"),
    ).toBe(true);
  });
});
