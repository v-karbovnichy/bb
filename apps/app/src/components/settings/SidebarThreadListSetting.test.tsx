// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider as JotaiProvider } from "jotai";
import { afterEach, describe, expect, it } from "vitest";
import {
  resetPluginSlotStoreForTest,
  setBuiltinPluginIds,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { threadListProviderAtom } from "@/components/sidebar/threadListProvider";
import { SidebarThreadListSetting } from "./SidebarThreadListSetting";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";

afterEach(async () => {
  cleanup();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  window.localStorage.clear();
  resetPluginSlotStoreForTest();
});

describe("SidebarThreadListSetting", () => {
  it("defaults to Автоматически, which prefers an installed plugin over the bundled Thread list", async () => {
    setBuiltinPluginIds(["thread-list"]);
    setPluginSlotRegistrations(
      "thread-list",
      makePluginRegistrationSet({
        threadLists: [
          {
            id: "thread-list",
            title: "Thread list",
            component: () => null,
          },
        ],
      }),
    );
    setPluginSlotRegistrations(
      "zen",
      makePluginRegistrationSet({
        threadLists: [
          {
            id: "inbox",
            title: "Inbox",
            component: () => null,
          },
        ],
      }),
    );
    const store = createStore();
    render(
      <JotaiProvider store={store}>
        <SidebarThreadListSetting />
      </JotaiProvider>,
    );

    expect(store.get(threadListProviderAtom)).toBe("__automatic__");
    const trigger = screen.getByRole("button", {
      name: "Список чатов в боковой панели",
    });
    expect(trigger.textContent).toContain("Автоматически");

    fireEvent.pointerDown(trigger, { button: 0 });
    expect(
      (await screen.findByRole("menuitem", { name: /Автоматически/u })).textContent,
    ).toContain("Выбирает Inbox (zen).");
    const options = screen
      .getAllByRole("menuitem")
      .map((item) => item.textContent ?? "");
    expect(options[1]).toContain("InboxИз плагина zen.");
    expect(options[2]).toBe("Thread list (встроенный)");
    fireEvent.click(
      screen.getByRole("menuitem", { name: /^Thread list \(встроенный\)/u }),
    );

    expect(store.get(threadListProviderAtom)).toBe("thread-list/thread-list");
  });
});
