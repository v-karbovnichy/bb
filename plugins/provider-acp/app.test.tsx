// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

const app = await loadPluginApp(() => import("./app"));

afterEach(cleanup);

function agent(
  id: string,
  name: string,
  status: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    name,
    version: "1.0.0",
    description: `${name} description`,
    repository: null,
    website: null,
    authors: [],
    license: null,
    launch: {
      kind: "npx" as const,
      package: `${id}@1.0.0`,
      args: [],
      env: {},
    },
    binaryPlatforms: [],
    providerId: `acp-${id}`,
    status,
    command: `npx -y ${id}@1.0.0`,
    icon: null,
    ...overrides,
  };
}

function registry(
  agents: unknown[],
  error: string | null = null,
): { fetchedAt: number; error: string | null; agents: unknown[] } {
  return { fetchedAt: 1, error, agents };
}

describe("ACP agent registry settings", () => {
  it("lists agents with the action each status allows and filters by search", async () => {
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        rpc: {
          listRegistry: () =>
            registry([
              agent("claude-acp", "Claude Agent", "available"),
              agent("gemini", "Gemini CLI", "added"),
              agent("goose", "Goose", "update-available"),
              agent("cursor", "Cursor", "built-in"),
              agent("native", "Native Only", "manual-install", {
                launch: null,
                command: null,
              }),
            ]),
        },
      },
    );
    await waitFor(() => expect(slot.getByText("Claude Agent")).toBeTruthy());

    expect(slot.getByRole("button", { name: "Добавить Claude Agent" })).toBeTruthy();
    expect(
      slot.getByRole("button", { name: "Удалить Gemini CLI" }),
    ).toBeTruthy();
    expect(slot.queryByRole("button", { name: "Добавить Gemini CLI" })).toBeNull();
    expect(slot.getByRole("button", { name: "Обновить Goose" })).toBeTruthy();
    expect(slot.getByRole("button", { name: "Удалить Goose" })).toBeTruthy();
    expect(slot.queryByRole("button", { name: /Cursor/ })).toBeNull();
    expect(slot.queryByRole("button", { name: /Native Only/ })).toBeNull();
    expect(slot.getByText("Команда: npx -y claude-acp@1.0.0")).toBeTruthy();
    expect(
      slot.getByText("Этот агент уже входит в bb как провайдер."),
    ).toBeTruthy();

    fireEvent.change(slot.getByLabelText("Поиск агентов"), {
      target: { value: "goos" },
    });
    expect(slot.queryByText("Claude Agent")).toBeNull();
    expect(slot.getByText("Goose")).toBeTruthy();

    fireEvent.change(slot.getByLabelText("Поиск агентов"), {
      target: { value: "zzz" },
    });
    expect(slot.getByText("Подходящие агенты не найдены.")).toBeTruthy();
  });

  it("adds an agent and shows the server's new list, and shows the reason when a change fails", async () => {
    const addRegistryAgent = vi.fn((input: unknown) => {
      if (JSON.stringify(input) === JSON.stringify({ id: "goose" })) {
        throw new Error("The custom agents setting is not valid JSON.");
      }
      return registry([
        agent("claude-acp", "Claude Agent", "added"),
        agent("goose", "Goose", "available"),
      ]);
    });
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        rpc: {
          listRegistry: () =>
            registry([
              agent("claude-acp", "Claude Agent", "available"),
              agent("goose", "Goose", "available"),
            ]),
          addRegistryAgent,
        },
      },
    );
    await waitFor(() => expect(slot.getByText("Claude Agent")).toBeTruthy());

    fireEvent.click(slot.getByRole("button", { name: "Добавить Claude Agent" }));
    await waitFor(() =>
      expect(
        slot.getByRole("button", { name: "Удалить Claude Agent" }),
      ).toBeTruthy(),
    );
    expect(addRegistryAgent.mock.calls[0]?.[0]).toEqual({ id: "claude-acp" });

    fireEvent.click(slot.getByRole("button", { name: "Добавить Goose" }));
    await waitFor(() =>
      expect(slot.getByRole("alert").textContent).toContain(
        "The custom agents setting is not valid JSON.",
      ),
    );
    expect(slot.getByRole("button", { name: "Добавить Goose" })).toBeTruthy();
  });

  it("says when it is showing a saved copy because the registry could not be reached", async () => {
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        rpc: {
          listRegistry: () =>
            registry(
              [agent("claude-acp", "Claude Agent", "available")],
              "The ACP registry answered 503.",
            ),
        },
      },
    );
    await waitFor(() =>
      expect(slot.getByRole("status").textContent).toBe(
        "Показана сохранённая копия. Не удалось связаться с каталогом: The ACP registry answered 503.",
      ),
    );
  });
});
