// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { MachineEnvironmentList } from "@bb/server-contract";
import {
  MachineEnvironmentSettings,
  ScopedMachineEnvironmentSettings,
} from "./MachineEnvironmentSettings";

vi.mock("@/hooks/queries/sidebar-navigation-query", () => ({
  useSidebarNavigation: () => ({
    data: { projects: [{ id: "proj-a", name: "Project A" }] },
  }),
}));

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  replace: vi.fn(),
  projectList: vi.fn(),
  projectReplace: vi.fn(),
}));
vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({
    data: { generalSettings: { machineGitCredentialsEnabled: true } },
  }),
}));
vi.mock("@/hooks/mutations/settings-mutations", () => ({
  useUpdateGeneralSettings: () => ({ isPending: false, mutate: vi.fn() }),
}));
vi.mock("@/lib/sdk", () => ({
  sdk: {
    projects: {
      machineEnvironment: mocks.projectList,
      replaceMachineEnvironment: mocks.projectReplace,
    },
    system: {
      machineEnvironment: mocks.list,
      replaceMachineEnvironment: mocks.replace,
    },
  },
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("crypto", {
    getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto),
    randomUUID: undefined,
  });
});

async function show(
  status: MachineEnvironmentList["builtInGit"]["status"] = "logged in",
) {
  mocks.list.mockResolvedValue({
    builtInGit: { status, statusMessage: "Git status" },
    variables: [{ name: "API_KEY", value: null, secret: true, note: null }],
  });
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MachineEnvironmentSettings />
    </QueryClientProvider>,
  );
  await screen.findByDisplayValue("API_KEY");
}

it("stages additions and preserves an unchanged saved secret", async () => {
  await show();
  fireEvent.click(screen.getByRole("button", { name: "Добавить переменную" }));
  fireEvent.change(screen.getByLabelText("Имя переменной 2"), {
    target: { value: "NEW_VALUE" },
  });
  fireEvent.change(screen.getByLabelText("Значение для NEW_VALUE"), {
    target: { value: "example" },
  });
  expect(mocks.replace).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Сохранить переменные" }));
  await waitFor(() =>
    expect(mocks.replace).toHaveBeenCalledExactlyOnceWith({
      variables: [
        { name: "API_KEY", value: null, note: null },
        { name: "NEW_VALUE", value: "example", note: null },
      ],
    }),
  );
});

it("stages removal and lets users discard it without deleting", async () => {
  await show();
  fireEvent.click(screen.getByRole("button", { name: "Удалить API_KEY" }));
  expect(screen.queryByDisplayValue("API_KEY")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Отменить изменения" }));
  expect(screen.getByDisplayValue("API_KEY")).toBeTruthy();
  expect(mocks.replace).not.toHaveBeenCalled();
});

it("retains a secret replacement when saving fails", async () => {
  await show();
  mocks.replace.mockRejectedValue(new Error("offline"));
  fireEvent.change(screen.getByLabelText("Значение для API_KEY"), {
    target: { value: "replacement" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Сохранить переменные" }));
  await screen.findByText(/Не все изменения удалось сохранить/);
  expect(screen.getByDisplayValue("replacement")).toBeTruthy();
});

it("saves an empty project override without copying inherited secrets and removes it to restore inheritance", async () => {
  const inherited = { name: "REGION", value: null, secret: true, note: null };
  const view = {
    builtInGit: { status: "disabled", statusMessage: "Выключено" },
    variables: [],
    inheritedVariables: [inherited],
  };
  mocks.projectList.mockResolvedValue(view);
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter>
        <ScopedMachineEnvironmentSettings projectId="project-a" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Переопределить REGION" }),
  );
  expect(
    screen.queryByRole("switch", { name: "Автоматический GH_TOKEN" }),
  ).toBeNull();
  mocks.projectList.mockResolvedValue({ ...view, variables: [inherited] });
  fireEvent.click(screen.getByRole("button", { name: "Сохранить переменные" }));
  await waitFor(() =>
    expect(mocks.projectReplace).toHaveBeenCalledWith({
      projectId: "project-a",
      variables: [{ name: "REGION", value: "", note: null }],
    }),
  );
  await waitFor(() =>
    expect(
      screen.getByLabelText("Значение для REGION").getAttribute("placeholder"),
    ).toContain("Секрет сохранён"),
  );
  fireEvent.click(screen.getByRole("button", { name: "Удалить REGION" }));
  mocks.projectList.mockResolvedValue(view);
  fireEvent.click(screen.getByRole("button", { name: "Сохранить переменные" }));
  await waitFor(() =>
    expect(mocks.projectReplace).toHaveBeenLastCalledWith({
      projectId: "project-a",
      variables: [],
    }),
  );
  expect(mocks.replace).not.toHaveBeenCalled();
  expect(
    await screen.findByRole("button", { name: "Переопределить REGION" }),
  ).toBeTruthy();
});

function variableNameOrder(): string[] {
  return [
    ...document.querySelectorAll<HTMLInputElement>(
      'input[aria-label^="Глобальная переменная "], input[aria-label^="Имя переменной "]',
    ),
  ].map((input) => input.value);
}

it("imports an inherited variable as one override and rejects partial malformed imports", async () => {
  mocks.projectList.mockResolvedValue({
    builtInGit: { status: "disabled", statusMessage: "Выключено" },
    variables: [],
    inheritedVariables: [
      { name: "REGION", value: null, secret: true, note: null },
    ],
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <ScopedMachineEnvironmentSettings projectId="project-a" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findByRole("button", { name: "Переопределить REGION" });
  fireEvent.click(screen.getByRole("button", { name: "Импортировать из .env" }));
  fireEvent.change(screen.getByLabelText("Содержимое файла окружения"), {
    target: { value: 'REGION=west\nBROKEN="unfinished' },
  });
  expect(
    screen.getByRole("button", { name: "Импортировать" }).hasAttribute("disabled"),
  ).toBe(true);
  fireEvent.change(screen.getByLabelText("Содержимое файла окружения"), {
    target: { value: "REGION=west" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Импортировать" }));
  expect(variableNameOrder()).toEqual(["REGION"]);
  expect(screen.queryByRole("button", { name: "Переопределить REGION" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Сохранить переменные" }));
  await waitFor(() =>
    expect(mocks.projectReplace).toHaveBeenCalledWith({
      projectId: "project-a",
      variables: [{ name: "REGION", value: "west", note: null }],
    }),
  );
});

it("replaces an inherited row in place instead of appending the override", async () => {
  mocks.projectList.mockResolvedValue({
    builtInGit: { status: "disabled", statusMessage: "Выключено" },
    variables: [{ name: "ZULU", value: null, secret: true, note: null }],
    inheritedVariables: [
      { name: "ALPHA", value: null, secret: true, note: null },
      { name: "REGION", value: null, secret: true, note: null },
    ],
  });
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter>
        <ScopedMachineEnvironmentSettings projectId="project-a" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findByRole("button", { name: "Переопределить REGION" });
  expect(variableNameOrder()).toEqual(["ALPHA", "REGION", "ZULU"]);
  fireEvent.click(screen.getByRole("button", { name: "Переопределить REGION" }));
  expect(variableNameOrder()).toEqual(["ALPHA", "REGION", "ZULU"]);
  expect(screen.getByRole("button", { name: "Удалить REGION" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Переопределить REGION" })).toBeNull();
});
