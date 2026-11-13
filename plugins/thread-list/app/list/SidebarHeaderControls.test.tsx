// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CompactViewportOverrideProvider } from "@/components/ui/hooks/use-compact-viewport";
import {
  installTestPluginRuntime,
  renderSlot,
} from "@get-bb/plugin-sdk/testing/app";
import { SIDEBAR_CONTROL_STATE_CLASS } from "@/components/ui/sidebar-row-classes";
import {
  sidebarThreadLifecyclesAtom,
  sidebarChronologicalSortAtom,
  sidebarOrganizationModeAtom,
  sidebarEnvironmentGroupingAtom,
  sidebarSortDirectionAtom,
  sidebarShowProviderIconsAtom,
  sidebarShowRowMetadataAtom,
} from "../preferences/atoms.js";
import type { OrganizationMode } from "../../shared/preferences.js";

installTestPluginRuntime();
const {
  SidebarHeaderActionsProvider,
  SidebarHeaderControls,
  SidebarSectionMenuItems,
} = await import("./SidebarHeaderControls.js");

afterEach(() => {
  cleanup();
});

function setup(
  label = "Закреплённые",
  section = false,
  organization: OrganizationMode = "project",
  compact = false,
  experiments: string[] = [],
) {
  const store = createStore();
  store.set(sidebarThreadLifecyclesAtom, ["active"]);
  store.set(sidebarOrganizationModeAtom, organization);
  store.set(sidebarChronologicalSortAtom, "updated");
  store.set(sidebarSortDirectionAtom, "default");
  store.set(sidebarEnvironmentGroupingAtom, "auto");
  store.set(sidebarShowProviderIconsAtom, false);
  store.set(sidebarShowRowMetadataAtom, false);
  const newThread = vi.fn();
  const newSection = vi.fn();
  const Harness = () => (
    <Provider store={store}>
      <CompactViewportOverrideProvider isCompactViewport={compact}>
        <TooltipProvider>
          <SidebarHeaderActionsProvider value={{ onNewSection: newSection }}>
            <SidebarHeaderControls label={label} onNewThread={newThread}>
              {section && (
                <SidebarSectionMenuItems
                  onRename={vi.fn()}
                  onRemove={vi.fn()}
                />
              )}
            </SidebarHeaderControls>
          </SidebarHeaderActionsProvider>
        </TooltipProvider>
      </CompactViewportOverrideProvider>
    </Provider>
  );
  renderSlot({ component: Harness }, {}, { experiments });
  return { store, newThread, newSection };
}

async function openMenu(label = "Закреплённые") {
  fireEvent.keyDown(
    screen.getByRole("button", {
      name: new RegExp(`^Действия: ${label}(?:;|$)`),
    }),
    {
      key: "Enter",
    },
  );
  await screen.findByRole("menuitem", { name: "Новый раздел" });
}

async function openSubmenu(label: string) {
  fireEvent.keyDown(screen.getByRole("menuitem", { name: label }), {
    key: "ArrowRight",
  });
}

describe("sidebar header controls", () => {
  it("supports keyboard selection when the menu first loads", async () => {
    const { store } = setup("Закреплённые", false, "chronological");
    await openMenu();
    const newSection = screen.getByRole("menuitem", { name: "Новый раздел" });
    fireEvent.keyDown(newSection.closest('[role="menu"]')!, { key: "Home" });
    await waitFor(() => expect(document.activeElement).toBe(newSection));
    await openSubmenu("Упорядочить");
    const project = await screen.findByRole("menuitemradio", {
      name: "По проектам",
    });
    fireEvent.keyDown(project.closest('[role="menu"]')!, { key: "ArrowDown" });
    await waitFor(() => expect(document.activeElement).toBe(project));
    fireEvent.keyDown(project, { key: "Enter" });
    expect(store.get(sidebarOrganizationModeAtom)).toBe("project");
  });

  it("dismisses on the first outside click after toggling environment grouping", async () => {
    setup();
    await openMenu();
    await openSubmenu("Упорядочить");
    const toggle = await screen.findByRole("menuitemcheckbox", {
      name: "По средам",
    });
    fireEvent.pointerDown(toggle, { button: 0, pointerType: "mouse" });
    fireEvent.pointerUp(toggle, { button: 0, pointerType: "mouse" });
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("false");

    fireEvent.pointerDown(document.body, { button: 0, pointerType: "mouse" });
    fireEvent.pointerUp(document.body, { button: 0, pointerType: "mouse" });
    fireEvent.click(document.body);
    await waitFor(() => {
      expect(
        screen.queryByRole("menuitemcheckbox", { name: "По средам" }),
      ).toBeNull();
      expect(
        screen.queryByRole("menuitem", { name: "Новый раздел" }),
      ).toBeNull();
    });
  });

  it("keeps the primary before overflow and applies the shared control state", async () => {
    const { newThread } = setup("Закреплённые", false, "chronological");
    const primary = screen.getByRole("button", {
      name: "Новый чат в Закреплённые",
    });
    expect(primary.nextElementSibling?.getAttribute("aria-label")).toBe(
      "Действия: Закреплённые",
    );
    for (const control of [primary, primary.nextElementSibling]) {
      for (const token of SIDEBAR_CONTROL_STATE_CLASS.split(" ")) {
        expect(control?.classList.contains(token)).toBe(true);
      }
      expect(control?.classList.contains("hover:bg-sidebar-accent")).toBe(
        false,
      );
      expect(control?.classList.contains("hover:text-foreground")).toBe(false);
      expect(control?.classList.contains("focus-visible:ring-1")).toBe(true);
      expect(control?.classList.contains("focus-visible:ring-ring")).toBe(true);
      expect(control?.className).not.toMatch(/focus-visible:(bg-|ring-[02]\b)/);
    }
    expect(primary.classList.contains("max-md:pointer-coarse:w-8")).toBe(true);
    expect(
      primary.nextElementSibling?.classList.contains(
        "max-md:pointer-coarse:w-9",
      ),
    ).toBe(true);
    expect(
      primary.parentElement?.classList.contains("max-md:pointer-coarse:gap-0"),
    ).toBe(true);
    fireEvent.click(primary);
    expect(newThread).toHaveBeenCalledOnce();
    await openMenu();
    expect(primary.nextElementSibling?.getAttribute("data-state")).toBe("open");
  });

  it("preserves creation callbacks and separates section editing/removal", async () => {
    const { newSection } = setup("Review", true);
    await openMenu("Review");
    expect(
      screen.getAllByRole("menuitem").map((item) => item.textContent),
    ).toEqual(["Новый раздел", "Упорядочить", "Сортировать по", "Фильтр", "Переименовать", "Удалить"]);
    expect(screen.getAllByRole("separator")).toHaveLength(3);
    fireEvent.click(screen.getByRole("menuitem", { name: "Новый раздел" }));
    expect(newSection).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(
        screen.queryByRole("menuitem", { name: "Новый раздел" }),
      ).toBeNull(),
    );
  });

  it("disables New section without a creation handler", async () => {
    const store = createStore();
    render(
      <Provider store={store}>
        <TooltipProvider>
          <SidebarHeaderControls label="Закреплённые" onNewThread={vi.fn()} />
        </TooltipProvider>
      </Provider>,
    );
    await openMenu();
    expect(
      screen
        .getByRole("menuitem", { name: "Новый раздел" })
        .getAttribute("aria-disabled"),
    ).toBe("true");
  });

  it("keeps Organize open and exclusive across selections", async () => {
    const { store } = setup();
    await openMenu();
    await openSubmenu("Упорядочить");
    const machine = await screen.findByRole("menuitemradio", {
      name: "По компьютерам",
    });
    expect(
      screen
        .getByRole("menuitemradio", { name: "По проектам" })
        .getAttribute("aria-checked"),
    ).toBe("true");

    fireEvent.click(machine);
    expect(store.get(sidebarOrganizationModeAtom)).toBe("machine");
    await waitFor(() =>
      expect(
        screen
          .getByRole("menuitemradio", { name: "По компьютерам" })
          .getAttribute("aria-checked"),
      ).toBe("true"),
    );
    expect(
      screen
        .getByRole("menuitemradio", { name: "По проектам" })
        .getAttribute("aria-checked"),
    ).toBe("false");

    fireEvent.click(screen.getByRole("menuitemradio", { name: "Вручную" }));
    expect(store.get(sidebarOrganizationModeAtom)).toBe("chronological");
    await waitFor(() =>
      expect(
        screen
          .getByRole("menuitemradio", { name: "Вручную" })
          .getAttribute("aria-checked"),
      ).toBe("true"),
    );
  });

  it("preserves the existing Organize groups without a Reset action", async () => {
    const { store } = setup("Закреплённые", false, "chronological");
    act(() => store.set(sidebarEnvironmentGroupingAtom, true));
    await openMenu();
    await openSubmenu("Упорядочить");
    const grouping = await screen.findByRole("menuitemcheckbox", {
      name: "По средам",
    });
    expect(screen.getByRole("group", { name: "Группы" })).toBeTruthy();
    expect(grouping.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(grouping);
    expect(store.get(sidebarEnvironmentGroupingAtom)).toBe(false);
    fireEvent.click(
      await screen.findByRole("menuitemradio", { name: "По проектам" }),
    );
    expect(store.get(sidebarOrganizationModeAtom)).toBe("project");
    expect(store.get(sidebarEnvironmentGroupingAtom)).toBe(false);
    expect(screen.queryByRole("menuitem", { name: /^Reset/ })).toBeNull();
  });

  it("toggles provider icons in the Organize Rows group", async () => {
    const { store } = setup();
    await openMenu();
    await openSubmenu("Упорядочить");
    const toggle = await screen.findByRole("menuitemcheckbox", {
      name: "Значки провайдеров",
    });
    expect(screen.getByRole("group", { name: "Строки" })).toBeTruthy();
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(toggle);
    expect(store.get(sidebarShowProviderIconsAtom)).toBe(true);
    expect(toggle.getAttribute("aria-checked")).toBe("true");
  });

  it("offers row metadata only while its experiment is on", async () => {
    setup();
    await openMenu();
    await openSubmenu("Упорядочить");
    await screen.findByRole("menuitemcheckbox", { name: "Значки провайдеров" });
    expect(
      screen.queryByRole("menuitemcheckbox", { name: "Метаданные" }),
    ).toBeNull();
  });

  it("toggles row metadata in the Organize Rows group", async () => {
    const { store } = setup("Закреплённые", false, "project", false, [
      "threadRowMetadata",
    ]);
    await openMenu();
    await openSubmenu("Упорядочить");
    const toggle = await screen.findByRole("menuitemcheckbox", {
      name: "Метаданные",
    });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(toggle);
    expect(store.get(sidebarShowRowMetadataAtom)).toBe(true);
    expect(toggle.getAttribute("aria-checked")).toBe("true");
  });

  it("resolves legacy sort, toggles direction, and resets it for another field", async () => {
    const { store } = setup();
    act(() => store.set(sidebarChronologicalSortAtom, "none"));
    await openMenu();
    await openSubmenu("Сортировать по");
    const updated = await screen.findByRole("menuitemradio", {
      name: "По дате обновления, по убыванию. Сортировать по возрастанию",
    });
    expect(updated.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(updated);
    expect(store.get(sidebarSortDirectionAtom)).toBe("ascending");
    fireEvent.click(
      screen.getByRole("menuitemradio", {
        name: "По дате обновления, по возрастанию. Сортировать по убыванию",
      }),
    );
    expect(store.get(sidebarSortDirectionAtom)).toBe("descending");
    fireEvent.click(
      screen.getByRole("menuitemradio", { name: "По алфавиту" }),
    );
    expect(store.get(sidebarChronologicalSortAtom)).toBe("alpha");
    expect(store.get(sidebarSortDirectionAtom)).toBe("ascending");
    expect(screen.queryByRole("menuitem", { name: /^Reset/ })).toBeNull();
    expect(
      screen
        .getByRole("menuitemradio", {
          name: "По алфавиту, по возрастанию. Сортировать по убыванию",
        })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("announces compact sort direction and resets the nested page after closing", async () => {
    const { store } = setup("Закреплённые", false, "project", true);
    fireEvent.click(
      screen.getByRole("button", { name: /^Действия: Закреплённые(?:;|$)/ }),
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Сортировать по" }));
    fireEvent.click(
      await screen.findByRole("menuitemradio", {
        name: /По дате обновления\s*, по убыванию\. Сортировать по возрастанию/,
      }),
    );
    expect(store.get(sidebarSortDirectionAtom)).toBe("ascending");
    expect(
      screen
        .getByRole("menuitemradio", {
          name: /По дате обновления\s*, по возрастанию\. Сортировать по убыванию/,
        })
        .getAttribute("aria-checked"),
    ).toBe("true");
    fireEvent.click(screen.getByRole("menuitem", { name: "Назад" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Упорядочить" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Вручную" }));
    expect(store.get(sidebarOrganizationModeAtom)).toBe("chronological");
    expect(
      screen
        .getByRole("menuitemradio", { name: "Вручную" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    fireEvent.click(
      screen.getByRole("button", { name: /^Действия: Закреплённые(?:;|$)/ }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("menuitem", { name: "Назад" })).toBeNull(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /^Действия: Закреплённые(?:;|$)/ }),
    );
    expect(
      await screen.findByRole("menuitem", { name: "Новый раздел" }),
    ).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Назад" })).toBeNull();
  });
});

it.each([false, true])(
  "keeps at least one lifecycle selected in the filter (compact=%s)",
  async (compact) => {
    const { store } = setup("Закреплённые", false, "project", compact);
    if (compact) {
      fireEvent.click(screen.getByRole("button", { name: /^Действия: Закреплённые(?:;|$)/ }));
      fireEvent.click(await screen.findByRole("menuitem", { name: "Фильтр" }));
    } else {
      await openMenu();
      await openSubmenu("Фильтр");
    }
    const active = await screen.findByRole("menuitemcheckbox", {
      name: "Активные",
    });
    fireEvent.click(active);
    expect(store.get(sidebarThreadLifecyclesAtom)).toEqual(["active"]);
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Архивные" }));
    expect(store.get(sidebarThreadLifecyclesAtom)).toEqual([
      "active",
      "archived",
    ]);
    fireEvent.click(active);
    expect(store.get(sidebarThreadLifecyclesAtom)).toEqual(["archived"]);
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Архивные" }));
    expect(store.get(sidebarThreadLifecyclesAtom)).toEqual(["archived"]);
  },
);
