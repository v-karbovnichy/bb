// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider as JotaiProvider } from "jotai";
import { afterEach, describe, expect, it } from "vitest";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import {
  diffRendererProviderAtom,
  sourceCodeRendererProviderAtom,
} from "@/components/code/codeRendererProvider";
import {
  AUTOMATIC_REPLACEMENT_PROVIDER,
  BUILT_IN_REPLACEMENT_PROVIDER,
} from "@/lib/plugin-replacement-preference";
import { CodeRendererSettings } from "./CodeRendererSettings";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";

const EMPTY_REGISTRATIONS = makePluginRegistrationSet();

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  resetPluginSlotStoreForTest();
});

describe("CodeRendererSettings", () => {
  it("shows no control until a plugin supplies a renderer", () => {
    render(
      <JotaiProvider store={createStore()}>
        <CodeRendererSettings />
      </JotaiProvider>,
    );

    expect(screen.queryByRole("button", { name: "Исходный код" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Изменения" })).toBeNull();
  });

  it("pins BB's diff renderer without touching the source-code choice", async () => {
    setPluginSlotRegistrations("inkwell", {
      ...EMPTY_REGISTRATIONS,
      sourceCodeRenderers: [
        { id: "source", title: "Inkwell source", component: () => null },
      ],
      diffRenderers: [
        { id: "diffs", title: "Inkwell diffs", component: () => null },
      ],
    });
    const store = createStore();
    render(
      <JotaiProvider store={store}>
        <CodeRendererSettings />
      </JotaiProvider>,
    );

    const diffTrigger = screen.getByRole("button", { name: "Изменения" });
    expect(diffTrigger.textContent).toContain("Автоматически");

    fireEvent.pointerDown(diffTrigger, { button: 0 });
    fireEvent.click(await screen.findByRole("menuitem", { name: /встроенный/u }));

    expect(store.get(diffRendererProviderAtom)).toBe(
      BUILT_IN_REPLACEMENT_PROVIDER,
    );
    expect(store.get(sourceCodeRendererProviderAtom)).toBe(
      AUTOMATIC_REPLACEMENT_PROVIDER,
    );
  });

  it("offers each registered provider by name", () => {
    setPluginSlotRegistrations("inkwell", {
      ...EMPTY_REGISTRATIONS,
      diffRenderers: [
        { id: "diffs", title: "Inkwell diffs", component: () => null },
      ],
    });
    setPluginSlotRegistrations("zed", {
      ...EMPTY_REGISTRATIONS,
      diffRenderers: [
        {
          id: "zed-diffs",
          title: "Zed diffs",
          description: "Side-by-side with word highlights.",
          component: () => null,
        },
      ],
    });
    const store = createStore();
    render(
      <JotaiProvider store={store}>
        <CodeRendererSettings />
      </JotaiProvider>,
    );

    const trigger = screen.getByRole("button", { name: "Изменения" });
    expect(trigger.textContent).toContain("Автоматически");
    fireEvent.pointerDown(trigger, { button: 0 });
    expect(
      screen.getByRole("menuitem", { name: /Выбирает Inkwell diffs/u }),
    ).toBeTruthy();
    const items = screen
      .getAllByRole("menuitem")
      .map((item) => item.textContent ?? "");
    expect(items).toHaveLength(4);
    expect(items[3]).toContain("bb (встроенный)");
    expect(items.some((text) => text.includes("Из плагина inkwell"))).toBe(
      true,
    );
    expect(
      items.some((text) => text.includes("Side-by-side with word highlights.")),
    ).toBe(true);
    expect(items.some((text) => text.includes("Плагин zed."))).toBe(true);
  });
});
