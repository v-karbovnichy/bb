// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { BbDesktopBrowserApi } from "@bb/desktop-contract";
import type { DesktopBrowserImportSource } from "@bb/host-daemon-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserSettingsSectionContent } from "./BrowserSettingsSection";
import { BROWSER_IMPORT_RECORDS_STORAGE_KEY } from "./browser-import-wizard";

vi.mock("@/components/ui/app-toast", () => ({
  appToast: { success: vi.fn(), error: vi.fn() },
}));

const PNG = "data:image/png;base64,iVBORw0KGgo=";

const sources: DesktopBrowserImportSource[] = [
  {
    id: "chrome",
    name: "Google Chrome",
    icon: PNG,
    profiles: [
      { directory: "По умолчанию", name: "Person 1", cookieCount: 3 },
      { directory: "Profile 1", name: "Work", cookieCount: 1 },
    ],
  },
  {
    id: "firefox",
    name: "Firefox",
    profiles: [{ directory: "Profiles/p1", name: "default", cookieCount: 9 }],
  },
  { id: "brave", name: "Brave", profiles: [], unavailable: "browserRunning" },
  { id: "arc", name: "Arc", profiles: [], unavailable: "notInstalled" },
  {
    id: "safari",
    name: "Safari",
    profiles: [],
    unavailable: "unsupportedPlatform",
  },
];

function makeDesktopBrowser(
  overrides: Partial<BbDesktopBrowserApi> = {},
): BbDesktopBrowserApi {
  const noop = () => undefined;
  return {
    attach: noop,
    detach: noop,
    navigate: noop,
    goBack: noop,
    goForward: noop,
    reload: noop,
    stop: noop,
    setBounds: noop,
    setVisible: noop,
    onState: () => noop,
    onOpenTab: () => noop,
    listImportSources: vi.fn(async () => ({ sources })),
    importCookies: vi.fn(async () => ({
      ok: true as const,
      imported: 2,
      skipped: 1,
      skippedDomains: ["accounts.example.com"],
    })),
    ...overrides,
  };
}

function rowButton(id: string): HTMLButtonElement {
  const button = screen
    .getByTestId(`browser-import-${id}`)
    .querySelector("button");
  if (!button) throw new Error(`no button in row ${id}`);
  return button;
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("BrowserSettingsSectionContent", () => {
  it("explains that import is desktop only outside the desktop app", () => {
    render(<BrowserSettingsSectionContent desktopBrowser={null} />);
    expect(
      screen.getByText("Доступно только в приложении BB для компьютера."),
    ).toBeDefined();
  });

  it("lists installed browsers with icons and status, hiding absent ones", async () => {
    render(
      <BrowserSettingsSectionContent desktopBrowser={makeDesktopBrowser()} />,
    );
    await waitFor(() =>
      expect(screen.getByText("Google Chrome")).toBeDefined(),
    );
    expect(screen.queryByText("Arc")).toBeNull();
    expect(screen.queryByText("Safari")).toBeNull();
    expect(
      screen
        .getByTestId("browser-import-chrome")
        .querySelector("img")
        ?.getAttribute("src"),
    ).toBe(PNG);
    expect(screen.getByText("Профилей: 2")).toBeDefined();
    expect(screen.getByText("Файлов cookie: 4")).toBeDefined();
    expect(screen.getByText("Запущен · закройте Brave для импорта")).toBeDefined();
    expect(rowButton("brave").textContent).toBe("Проверить снова");
  });

  it.each(["firefox", `storage-${"b".repeat(64)}`])(
    "imports %s directly and records it in the row",
    async (sourceId) => {
      const desktopBrowser = makeDesktopBrowser({
        listImportSources: vi.fn(async () => ({
          sources: sources.map((source) =>
            source.id === "firefox" ? { ...source, id: sourceId } : source,
          ),
        })),
      });
      render(<BrowserSettingsSectionContent desktopBrowser={desktopBrowser} />);
      await waitFor(() => expect(screen.getByText("Firefox")).toBeDefined());
      fireEvent.click(rowButton(sourceId));
      await waitFor(() =>
        expect(screen.getByText("default · импортировано: Файлов cookie: 2")).toBeDefined(),
      );
      expect(desktopBrowser.importCookies).toHaveBeenCalledWith({
        sourceId,
        sourceProfileDirectory: "Profiles/p1",
      });
      expect(
        screen.getByText("Пропущено: 1 (accounts.example.com)"),
      ).toBeDefined();
      expect(screen.getByText("импортировано только что")).toBeDefined();
      expect(
        JSON.parse(
          window.localStorage.getItem(BROWSER_IMPORT_RECORDS_STORAGE_KEY) ??
            "{}",
        )[sourceId].imported,
      ).toBe(2);
    },
  );

  it("asks for a profile when a browser has several, then imports it", async () => {
    const desktopBrowser = makeDesktopBrowser();
    render(<BrowserSettingsSectionContent desktopBrowser={desktopBrowser} />);
    await waitFor(() =>
      expect(screen.getByText("Google Chrome")).toBeDefined(),
    );
    fireEvent.click(rowButton("chrome"));
    expect(screen.getByText("Импорт из Google Chrome")).toBeDefined();
    fireEvent.click(screen.getByRole("radio", { name: /Work/ }));
    fireEvent.click(screen.getByRole("button", { name: "Импортировать · Файлов cookie: 1" }));
    await waitFor(() =>
      expect(screen.getByText("Work · импортировано: Файлов cookie: 2")).toBeDefined(),
    );
    expect(screen.queryByText("Импорт из Google Chrome")).toBeNull();
  });

  it("rechecks a running browser from its row", async () => {
    const listImportSources = vi
      .fn()
      .mockResolvedValueOnce({ sources })
      .mockResolvedValue({
        sources: sources.map((source) =>
          source.id === "brave"
            ? {
                ...source,
                unavailable: undefined,
                profiles: [
                  { directory: "По умолчанию", name: "По умолчанию", cookieCount: 5 },
                ],
              }
            : source,
        ),
      });
    render(
      <BrowserSettingsSectionContent
        desktopBrowser={makeDesktopBrowser({ listImportSources })}
      />,
    );
    await waitFor(() => expect(screen.getByText("Brave")).toBeDefined());
    fireEvent.click(rowButton("brave"));
    await waitFor(() => expect(rowButton("brave").textContent).toBe("Импортировать…"));
    expect(screen.getByText("Файлов cookie: 5")).toBeDefined();
  });
});
