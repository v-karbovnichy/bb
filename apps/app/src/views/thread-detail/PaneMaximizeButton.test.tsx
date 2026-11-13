// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import type { BbDesktopInfo } from "@bb/desktop-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBbDesktopApi } from "@/test/bb-desktop-test-utils";
import { focusWithKeyboard } from "@/test/keyboard-focus";
import { useIsBrowserDimmingModalOpen } from "@/hooks/useBrowserDimmingModal";
import { PaneContext, type PaneContextValue } from "./PaneContext";
import { PaneMaximizeButton } from "./PaneMaximizeButton";

vi.mock("@/components/commands/AppCommandProvider", () => ({
  useAppCommandShortcut: () => ({
    ariaKeyshortcuts: "Meta+Shift+E",
    label: "⌘⇧E",
  }),
}));

const noop = () => {};

function BrowserOverlayProbe() {
  return (
    <span data-testid="browser-overlay-state">
      {useIsBrowserDimmingModalOpen() ? "hidden" : "visible"}
    </span>
  );
}

function renderButton(
  isMaximized: boolean,
  onToggleMaximize: () => void = noop,
  onMoveToSide: PaneContextValue["onMoveToSide"] = noop,
) {
  const value: PaneContextValue = {
    paneId: "pane-1",
    isFocused: true,
    isSplitPane: true,
    secondaryPanelHost: null,
    reservesWindowPanelToggle: false,
    onRequestClose: noop,
    isMaximized,
    onToggleMaximize,
    onMoveToSide,
    isBoundedPane: true,
    isTopRow: true,
    ownsWindowTopLeft: true,
    navigateInPane: noop,
  };
  return render(
    <TooltipProvider delayDuration={0}>
      <PaneContext.Provider value={value}>
        <PaneMaximizeButton />
        <BrowserOverlayProbe />
      </PaneContext.Provider>
    </TooltipProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete window.bbDesktop;
});

describe("PaneMaximizeButton", () => {
  it("renders a keyboard-focusable native button that maximizes a web pane", () => {
    const onToggle = vi.fn();
    renderButton(false, onToggle);
    const button = screen.getByRole("button", {
      name: "Развернуть панель (⌘⇧E)",
    });

    expect(button.getAttribute("aria-keyshortcuts")).toBe("Meta+Shift+E");
    expect(button.getAttribute("aria-pressed")).toBe("false");
    button.focus();
    expect(document.activeElement).toBe(button);
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("type")).toBe("button");
    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("restores a web split on click and uses the clear tooltip copy", async () => {
    const onToggle = vi.fn();
    renderButton(true, onToggle);
    const button = screen.getByRole("button", {
      name: "Восстановить разделение (⌘⇧E)",
    });
    expect(button.getAttribute("aria-pressed")).toBe("true");

    focusWithKeyboard(button);
    await waitFor(() => {
      expect(
        screen
          .getAllByRole("tooltip")
          .some((tooltip) => tooltip.textContent?.includes("Восстановить разделение")),
      ).toBe(true);
    });

    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("shows only BB's supported split arrangement actions on hover", () => {
    vi.useFakeTimers();
    const onMoveToSide = vi.fn();
    renderButton(false, noop, onMoveToSide);
    const button = screen.getByRole("button", {
      name: "Развернуть панель (⌘⇧E)",
    });

    fireEvent.pointerEnter(button);
    act(() => {
      vi.advanceTimersByTime(399);
    });
    expect(screen.queryByRole("menu", { name: "Расположение панелей" })).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    const menu = screen.getByRole("menu", { name: "Расположение панелей" });
    expect(menu.textContent).toContain("Развернуть панель");
    expect(menu.textContent).toContain("Переместить");
    expect(
      screen.getAllByRole("menuitem").map((item) => item.textContent),
    ).toEqual(["Развернуть панель⌘⇧E", "", "", "", ""]);
    for (const side of ["left", "right", "top", "bottom"]) {
      const action = screen.getByRole("menuitem", {
        name: ({ left: "Переместить влево", right: "Переместить вправо", top: "Переместить вверх", bottom: "Переместить вниз" } as const)[side as "left" | "right" | "top" | "bottom"],
      });
      expect(
        action.querySelector(`[data-pane-arrangement-glyph="${side}"]`),
      ).not.toBeNull();
      expect(action.className).toContain("cursor-pointer");
    }
    expect(
      screen.getByRole("menuitem", { name: /Развернуть панель/ }).className,
    ).toContain("cursor-pointer");

    fireEvent.click(screen.getByRole("menuitem", { name: "Переместить влево" }));
    expect(onMoveToSide).toHaveBeenCalledWith("left");
  });

  it("keeps the arrangement menu open for keyboard focus and enters it with Arrow Down", () => {
    vi.useFakeTimers();
    const onMoveToSide = vi.fn();
    renderButton(false, noop, onMoveToSide);
    const button = screen.getByRole("button", {
      name: "Развернуть панель (⌘⇧E)",
    });

    fireEvent.focus(button);
    const menu = screen.getByRole("menu", { name: "Расположение панелей" });
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(menu.isConnected).toBe(true);

    fireEvent.keyDown(button, { key: "ArrowDown" });
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(document.activeElement).toBe(
      screen.getByRole("menuitem", { name: /Развернуть панель/ }),
    );

    const moveBottom = screen.getByRole("menuitem", { name: "Переместить вниз" });
    moveBottom.focus();
    moveBottom.click();
    expect(onMoveToSide).toHaveBeenCalledWith("bottom");
  });

  it("keeps the menu closed while the pointer only passes over the button", () => {
    vi.useFakeTimers();
    renderButton(false);
    const button = screen.getByRole("button", {
      name: "Развернуть панель (⌘⇧E)",
    });

    fireEvent.pointerEnter(button);
    fireEvent.pointerLeave(button);

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.queryByRole("menu", { name: "Расположение панелей" })).toBeNull();
  });

  it("preserves full-screen copy in every desktop app context", async () => {
    const desktopInfo: BbDesktopInfo = {
      lastCheckedAt: null,
      latestVersion: null,
      pendingVersion: null,
      platform: "linux",
      updateAvailable: false,
      updateDownloaded: false,
      version: "0.0.0-test",
    };
    window.bbDesktop = createBbDesktopApi(desktopInfo);
    renderButton(false);

    const button = screen.getByRole("button", {
      name: "На весь экран (⌘⇧E)",
    });
    fireEvent.focus(button);
    const menu = await screen.findByRole("menu", { name: "Расположение панелей" });
    expect(
      screen.getByRole("menuitem", { name: /На весь экран/ }),
    ).not.toBeNull();
    expect(menu.textContent).not.toContain("Развернуть панель");

    cleanup();
    renderButton(true);
    expect(
      screen.getByRole("button", { name: "Выйти из полноэкранного режима (⌘⇧E)" }),
    ).not.toBeNull();
  });

  it("hides the native desktop browser while the arrangement menu can cover it", () => {
    vi.useFakeTimers();
    const desktopInfo: BbDesktopInfo = {
      lastCheckedAt: null,
      latestVersion: null,
      pendingVersion: null,
      platform: "macos",
      updateAvailable: false,
      updateDownloaded: false,
      version: "0.0.0-test",
    };
    window.bbDesktop = createBbDesktopApi(desktopInfo);
    renderButton(false);
    expect(screen.getByTestId("browser-overlay-state").textContent).toBe(
      "visible",
    );

    const trigger = screen.getByRole("button", {
      name: "На весь экран (⌘⇧E)",
    });
    fireEvent.pointerEnter(trigger);
    act(() => {
      vi.advanceTimersByTime(400);
    });
    const menu = screen.getByRole("menu", {
      name: "Расположение панелей",
    });
    fireEvent.pointerLeave(trigger);
    fireEvent.pointerEnter(menu);
    expect(screen.getByTestId("browser-overlay-state").textContent).toBe(
      "hidden",
    );

    fireEvent.pointerLeave(menu);
    act(() => {
      vi.advanceTimersByTime(99);
    });
    expect(screen.getByTestId("browser-overlay-state").textContent).toBe(
      "hidden",
    );
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByTestId("browser-overlay-state").textContent).toBe(
      "visible",
    );
  });

  it("does not render outside a multi-pane workspace", () => {
    const value: PaneContextValue = {
      paneId: "main",
      isFocused: true,
      isSplitPane: false,
      secondaryPanelHost: null,
      reservesWindowPanelToggle: false,
      onRequestClose: null,
      isMaximized: false,
      onToggleMaximize: null,
      isBoundedPane: false,
      isTopRow: true,
      ownsWindowTopLeft: true,
      navigateInPane: noop,
    };
    render(
      <PaneContext.Provider value={value}>
        <PaneMaximizeButton />
      </PaneContext.Provider>,
    );
    expect(screen.queryByRole("button")).toBeNull();
  });
});
