// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { PROJECT_CHECKOUT_ENVIRONMENT_PROVIDER_ID } from "./provider-id.js";

const app = await loadPluginApp(() => import("./app"));
const { readCheckoutInputs } = await import("./app");

afterEach(() => {
  cleanup();
});

function inputsSlot() {
  const registration = app.environmentProviderInputs.find(
    (candidate) =>
      candidate.environmentProviderId ===
      PROJECT_CHECKOUT_ENVIRONMENT_PROVIDER_ID,
  );
  if (registration === undefined) {
    throw new Error("the checkout inputs control was not registered");
  }
  return registration;
}

describe("checkout inputs control", () => {
  it("selects a remote branch before the new machine exists", async () => {
    const onChange = vi.fn();
    const slot = renderSlot(
      inputsSlot(),
      {
        projectId: "project-1",
        target: { kind: "new-host" },
        value: null,
        onChange,
      },
      {
        branchesState: {
          branches: ["local-only"],
          remoteBranches: ["origin/main", "origin/release"],
        },
      },
    );
    const trigger = slot.getByRole("combobox", { name: "Ветка" });
    expect(trigger.textContent).toContain("Ветка по умолчанию");
    expect(trigger.hasAttribute("disabled")).toBe(false);
    fireEvent.click(trigger);
    fireEvent.click(await slot.findByRole("button", { name: "Переключиться" }));
    fireEvent.click(await slot.findByRole("button", { name: "release" }));
    expect(onChange).toHaveBeenLastCalledWith({
      status: "ready",
      value: { branch: { kind: "existing", name: "release" } },
    });
  });

  it("submits the current checkout as soon as it mounts", async () => {
    const onChange = vi.fn();
    renderSlot(inputsSlot(), {
      projectId: "project-1",
      target: { kind: "existing-host", hostId: "host-a" },
      value: null,
      onChange,
    });
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith({ status: "ready", value: {} });
    });
  });

  it("renders the current checkout chip", () => {
    const slot = renderSlot(inputsSlot(), {
      projectId: "project-1",
      target: { kind: "existing-host", hostId: "host-a" },
      value: null,
      onChange: vi.fn(),
    });
    expect(
      slot.getByRole("combobox", { name: "Ветка" }).textContent,
    ).toContain("Текущая (main)");
  });

  it("renders an existing branch pick on the chip", () => {
    const slot = renderSlot(inputsSlot(), {
      projectId: "project-1",
      target: { kind: "existing-host", hostId: "host-a" },
      value: { branch: { kind: "existing", name: "release" } },
      onChange: vi.fn(),
    });
    expect(
      slot.getByRole("combobox", { name: "Ветка" }).textContent,
    ).toContain("Переключиться:release");
  });

  it("renders a new branch base on the chip", () => {
    const slot = renderSlot(inputsSlot(), {
      projectId: "project-1",
      target: { kind: "existing-host", hostId: "host-a" },
      value: { branch: { kind: "new", baseBranch: "origin/main" } },
      onChange: vi.fn(),
    });
    const chipText = slot.getByRole("combobox", { name: "Ветка" }).textContent;
    expect(chipText).toContain("Новая ветка от");
    expect(chipText).toContain("origin/main");
  });

  it("keeps a seeded path while the branch changes", async () => {
    const onChange = vi.fn();
    const slot = renderSlot(
      inputsSlot(),
      {
        projectId: "project-1",
        target: { kind: "existing-host", hostId: "host-a" },
        value: { path: "/srv/other-checkout" },
        onChange,
      },
      { branchesState: { branches: ["main", "release"] } },
    );
    fireEvent.click(slot.getByRole("combobox", { name: "Ветка" }));
    fireEvent.click(await slot.findByRole("button", { name: "Переключиться" }));
    fireEvent.click(await slot.findByRole("button", { name: "release" }));
    expect(onChange).toHaveBeenLastCalledWith({
      status: "ready",
      value: {
        path: "/srv/other-checkout",
        branch: { kind: "existing", name: "release" },
      },
    });
    cleanup();
    const cleared = renderSlot(inputsSlot(), {
      projectId: "project-1",
      target: { kind: "existing-host", hostId: "host-a" },
      value: {
        path: "/srv/other-checkout",
        branch: { kind: "existing", name: "release" },
      },
      onChange,
    });
    fireEvent.click(cleared.getByRole("combobox", { name: "Ветка" }));
    fireEvent.click(await cleared.findByTitle("Текущая: main"));
    expect(onChange).toHaveBeenLastCalledWith({
      status: "ready",
      value: { path: "/srv/other-checkout" },
    });
  });

  it("selects a searched existing branch with Enter and closes", async () => {
    const onChange = vi.fn();
    const slot = renderSlot(
      inputsSlot(),
      {
        projectId: "project-1",
        target: { kind: "existing-host", hostId: "host-a" },
        value: null,
        onChange,
      },
      { branchesState: { branches: ["main", "release"] } },
    );
    const trigger = slot.getByRole("combobox", { name: "Ветка" });
    fireEvent.click(trigger);
    fireEvent.click(await slot.findByRole("button", { name: "Переключиться" }));
    const search = await slot.findByRole("textbox", {
      name: "Поиск веток",
    });
    fireEvent.change(search, { target: { value: "release" } });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith({
      status: "ready",
      value: { branch: { kind: "existing", name: "release" } },
    });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("selects a searched new-branch base with Enter and closes", async () => {
    const onChange = vi.fn();
    const slot = renderSlot(
      inputsSlot(),
      {
        projectId: "project-1",
        target: { kind: "existing-host", hostId: "host-a" },
        value: { branch: { kind: "new", baseBranch: "main" } },
        onChange,
      },
      { branchesState: { branches: ["main", "release"] } },
    );
    const trigger = slot.getByRole("combobox", { name: "Ветка" });
    fireEvent.click(trigger);
    const search = await slot.findByRole("textbox", {
      name: "Поиск веток",
    });
    fireEvent.change(search, { target: { value: "release" } });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith({
      status: "ready",
      value: { branch: { kind: "new", baseBranch: "release" } },
    });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("reports the checkout blocker through the inputs channel", async () => {
    const onChange = vi.fn();
    const slot = renderSlot(
      inputsSlot(),
      {
        projectId: "project-1",
        target: { kind: "existing-host", hostId: "host-a" },
        value: { branch: { kind: "existing", name: "release" } },
        onChange,
      },
      {
        branchesState: { branches: ["main", "release"] },
        checkoutState: { dirty: true },
      },
    );
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith({
        status: "blocked",
        reason: "Переключение заблокировано несохранёнными изменениями",
      });
    });
    expect(
      slot.getByRole("combobox", { name: "Ветка" }).textContent,
    ).toContain("Переключиться:release");
    fireEvent.click(slot.getByRole("combobox", { name: "Ветка" }));
    const newBranch = (await slot.findByText("Новая")).closest("button");
    expect(newBranch).not.toBeNull();
    expect(newBranch).toHaveProperty("disabled", true);
    expect(newBranch?.getAttribute("title")).toBe(
      "Переключение заблокировано несохранёнными изменениями",
    );
    expect(
      slot.getByRole("status").textContent,
    ).toBe(
      "Создайте коммит или спрячьте изменения, чтобы создать другую ветку или переключиться на неё.",
    );
    expect(slot.queryByRole("button", { name: "release" })).toBeNull();
    expect(slot.queryByRole("textbox", { name: "Поиск веток" })).toBeNull();
  });

  it("explains why branch actions are unavailable during a Git operation", async () => {
    const slot = renderSlot(
      inputsSlot(),
      {
        projectId: "project-1",
        target: { kind: "existing-host", hostId: "host-a" },
        value: null,
        onChange: vi.fn(),
      },
      {
        checkoutState: {
          operation: { kind: "merge", hasConflicts: true },
        },
      },
    );
    fireEvent.click(slot.getByRole("combobox", { name: "Ветка" }));
    expect(
      (await slot.findByRole("button", { name: "Переключиться" })).hasAttribute(
        "disabled",
      ),
    ).toBe(true);
    expect(slot.getByRole("status").textContent).toBe(
      "Разрешите конфликты и завершите или отмените операцию Git, чтобы сменить ветку.",
    );
  });

  it("matches the checkout menu structure and enters new-branch mode in place", async () => {
    const onChange = vi.fn();
    const slot = renderSlot(
      inputsSlot(),
      {
        projectId: "project-1",
        target: { kind: "existing-host", hostId: "host-a" },
        value: null,
        onChange,
      },
      {
        branchesState: {
          branches: ["main", "release"],
          remoteBranches: ["origin/main"],
        },
      },
    );
    const trigger = slot.getByRole("combobox", { name: "Ветка" });
    fireEvent.click(trigger);

    expect(await slot.findByText("Исходная ветка:")).toBeTruthy();
    expect(slot.getAllByTitle("Текущая: main")).toHaveLength(2);
    expect(slot.getByTitle("Новая ветка")).toBeTruthy();
    expect(slot.getByTitle("Переключиться на существующую ветку")).toBeTruthy();
    expect(slot.queryByRole("textbox", { name: "Поиск веток" })).toBeNull();

    fireEvent.click(slot.getByTitle("Новая ветка"));

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(await slot.findByText("Ветка от:")).toBeTruthy();
    expect(slot.getByRole("textbox", { name: "Поиск веток" })).toBeTruthy();
    expect(slot.getByRole("button", { name: "origin/main" })).toBeTruthy();
    expect(onChange).toHaveBeenLastCalledWith({
      status: "ready",
      value: { branch: { kind: "new", baseBranch: "main" } },
    });
  });

  it("reads only a well-formed branch out of the current value", () => {
    expect(
      readCheckoutInputs({ branch: { kind: "existing", name: "main" } }),
    ).toEqual({ path: null, branch: { kind: "existing", name: "main" } });
    expect(
      readCheckoutInputs({ branch: { kind: "named", name: "main" } }),
    ).toEqual({ path: null, branch: null });
    expect(readCheckoutInputs("main")).toEqual({ path: null, branch: null });
  });
});
