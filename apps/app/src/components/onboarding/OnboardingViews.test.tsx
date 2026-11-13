// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import {
  RedesignedDevicesStep,
  AgentInstallErrorDetails,
  AgentSignInInstruction,
  AgentSignInPanel,
  AgentStep,
  OnboardingLayout,
  ProjectsStep,
  type AgentLoadingRow,
  type OnboardingAgent,
  type OnboardingRepo,
} from "./OnboardingViews";
import type { AgentSetupState } from "./onboarding-model";

function agent(id: string, state: AgentSetupState): OnboardingAgent {
  return { id, name: id, provider: { id, logoUrl: null }, state };
}

function renderAgents(agents: (OnboardingAgent | AgentLoadingRow)[]) {
  const handlers = {
    onSignIn: vi.fn(),
    onInstall: vi.fn(),
    onViewInstallLog: vi.fn(),
    onCancelSignIn: vi.fn(),
    onRecheck: vi.fn(),
  };
  render(
    <AgentStep
      machineName="bee"
      agents={agents}
      loadFailedMessage={null}
      {...handlers}
    />,
  );
  return handlers;
}

afterEach(cleanup);

describe("AgentStep", () => {
  it("shows loaded agents in place while others are still loading", () => {
    renderAgents([
      agent("codex", { status: "install", canInstall: true }),
      { loadingKey: "claude-code" },
      agent("pi", { status: "install", canInstall: true }),
      { loadingKey: "more" },
    ]);

    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(4);
    expect(within(rows[0]!).getByText("codex")).toBeTruthy();
    expect(rows[1]!.dataset.testid).toBe("agent-row-skeleton");
    expect(within(rows[2]!).getByText("pi")).toBeTruthy();
    expect(rows[3]!.dataset.testid).toBe("agent-row-skeleton");
  });

  it("offers the install log only on the agent whose install failed", () => {
    const handlers = renderAgents([
      agent("claude-code", { status: "install", canInstall: true }),
      agent("codex", {
        status: "installFailed",
        message: "Не удалось установить",
        canInstall: true,
      }),
      agent("pi", { status: "installing", update: false }),
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Посмотреть журнал" }));

    expect(handlers.onViewInstallLog).toHaveBeenCalledExactlyOnceWith("codex");
    expect(handlers.onInstall).not.toHaveBeenCalled();
  });

  it("keeps the install log reachable when the machine offers no retry", () => {
    const handlers = renderAgents([
      agent("codex", {
        status: "installFailed",
        message: "Не удалось установить",
        canInstall: false,
      }),
    ]);

    expect(screen.queryByRole("button", { name: "Повторить" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Посмотреть журнал" }));

    expect(handlers.onViewInstallLog).toHaveBeenCalledExactlyOnceWith("codex");
  });
});

describe("AgentStep in the redesigned guide", () => {
  it("keeps a failed install quiet and keeps a way out of signing in", () => {
    const onCancelSignIn = vi.fn();
    render(
      <TooltipProvider>
        <AgentStep
          quiet
          machineName="bee"
          agents={[
            agent("codex", {
              status: "installFailed",
              message: "Не удалось установить. Проверьте подключение и попробуйте ещё раз.",
              canInstall: true,
            }),
            agent("claude-code", { status: "signingIn" }),
          ]}
          loadFailedMessage={null}
          onSignIn={vi.fn()}
          onInstall={vi.fn()}
          onViewInstallLog={vi.fn()}
          onCancelSignIn={onCancelSignIn}
          onRecheck={vi.fn()}
        />
      </TooltipProvider>,
    );

    expect(screen.getByRole("button", { name: /Повторить/u })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Посмотреть журнал" })).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Отменить вход в claude-code" }),
    );
    expect(onCancelSignIn).toHaveBeenCalledExactlyOnceWith("claude-code");
    expect(
      screen.getByText(
        "Не видите своего агента? bb обнаружит другие ACP-агенты после их установки.",
      ),
    ).toBeTruthy();
  });
});

describe("OnboardingLayout stepper", () => {
  function renderAt(skipped: ReadonlySet<"agent" | "projects">) {
    const onSelectStep = vi.fn();
    render(
      <OnboardingLayout
        step="plugins"
        composition="centered"
        showSkipAll={false}
        skippedSteps={skipped}
        title="Настройте bb под себя"
        description=""
        primaryLabel="Продолжить"
        onPrimary={vi.fn()}
        onSelectStep={onSelectStep}
        onSkipAll={vi.fn()}
      >
        <div />
      </OnboardingLayout>,
    );
    return onSelectStep;
  }

  it("marks a step passed without finishing as skipped and still lets people go back to it", () => {
    const onSelectStep = renderAt(new Set(["projects"]));

    fireEvent.click(screen.getByRole("button", { name: "Проекты (пропущено)" }));

    expect(onSelectStep).toHaveBeenCalledExactlyOnceWith("projects");
    expect(screen.getByRole("button", { name: "Агент" })).toBeTruthy();
    expect(screen.queryByText("Пропустить настройку")).toBeNull();
  });
});

describe("ProjectsStep selection", () => {
  function repo(id: string, added = false): OnboardingRepo {
    return {
      id,
      name: id,
      path: `/projects/${id}`,
      lastActive: "1h ago",
      remote: null,
      added,
    };
  }

  function renderProjects(args: {
    selection?: "line" | "header";
    repos: OnboardingRepo[];
    selectedIds: string[];
  }) {
    const handlers = {
      onToggle: vi.fn(),
      onSelectAll: vi.fn(),
      onSelectNone: vi.fn(),
      onAddFolder: vi.fn(),
      onRetry: vi.fn(),
    };
    render(
      <ProjectsStep
        {...(args.selection === undefined ? {} : { selection: args.selection })}
        status={{ kind: "results", truncated: false }}
        repos={args.repos}
        selectedIds={new Set(args.selectedIds)}
        {...handlers}
      />,
    );
    return handlers;
  }

  it("keeps today's count line by default", () => {
    renderProjects({ repos: [repo("a"), repo("b")], selectedIds: ["a"] });

    expect(screen.getByText("Выбрано 1 из 2")).toBeTruthy();
    expect(
      screen.queryByRole("checkbox", { name: "Выбрать все проекты" }),
    ).toBeNull();
  });

  it("selects every project from a partly selected header", () => {
    const handlers = renderProjects({
      selection: "header",
      repos: [repo("a"), repo("b"), repo("c", true)],
      selectedIds: ["a"],
    });

    expect(screen.queryByText(/selected/u)).toBeNull();
    const header = screen.getByRole("checkbox", {
      name: "Выбрать все проекты",
    });
    expect(header.getAttribute("data-state")).toBe("indeterminate");
    expect(header.className).toContain(
      "data-[state=indeterminate]:bg-foreground",
    );
    expect(header.querySelector("[data-icon]")?.getAttribute("data-icon")).toBe(
      "Minus",
    );
    fireEvent.click(header);

    expect(handlers.onSelectAll).toHaveBeenCalledOnce();
    expect(handlers.onSelectNone).not.toHaveBeenCalled();
  });

  it("clears the selection when every selectable project is checked", () => {
    const handlers = renderProjects({
      selection: "header",
      repos: [repo("a"), repo("b"), repo("c", true)],
      selectedIds: ["a", "b"],
    });

    const header = screen.getByRole("checkbox", {
      name: "Снять выделение проектов",
    });
    expect(header.getAttribute("data-state")).toBe("checked");
    fireEvent.click(header);

    expect(handlers.onSelectNone).toHaveBeenCalledOnce();
  });

  it("disables the header when every project is already added", () => {
    renderProjects({
      selection: "header",
      repos: [repo("a", true)],
      selectedIds: [],
    });

    const header = screen.getByRole("checkbox", {
      name: "Выбрать все проекты",
    });
    expect(header.getAttribute("data-state")).toBe("unchecked");
    expect(header.hasAttribute("disabled")).toBe(true);
  });

  it("labels the time column in the header, outside the select-all control", () => {
    renderProjects({
      selection: "header",
      repos: [repo("a"), repo("b")],
      selectedIds: ["a"],
    });

    const label = screen.getByText("Последняя активность");
    expect(label.closest("label")).toBeNull();
    expect(
      label.closest("li")?.querySelector('[aria-label="Выбрать все проекты"]'),
    ).not.toBeNull();
  });
});

describe("AgentSignInInstruction", () => {
  function renderInstruction(
    url: string | null,
    overrides: {
      userCode?: string;
      paste?: boolean;
      agentName?: string;
      onOpenUrl?: (url: string) => void;
    } = {},
  ) {
    render(
      <p data-testid="instruction">
        <AgentSignInInstruction
          agentName={overrides.agentName ?? "Cursor"}
          view={{
            guide:
              url === null
                ? null
                : {
                    url,
                    userCode: overrides.userCode ?? null,
                    acceptsPastedCode: overrides.paste ?? false,
                  },
            terminalVisible: false,
            started: url !== null,
          }}
          onOpenUrl={overrides.onOpenUrl ?? vi.fn()}
        />
      </p>,
    );
    return screen.getByTestId("instruction");
  }

  it("names the website to sign in on", () => {
    const line = renderInstruction("https://www.cursor.com/login");

    expect(screen.getByRole("link", { name: "cursor.com" })).toBeTruthy();
    expect(line.textContent).toBe("Войдите на cursor.com.");
  });

  it("names the website for paste sign-ins", () => {
    expect(
      renderInstruction("https://claude.ai/oauth/authorize", { paste: true })
        .textContent,
    ).toBe("Войдите на claude.ai, затем вставьте показанный код.");
  });

  it("links the browser when the URL has no website", () => {
    const url = "file:///tmp/sign-in";
    expect(renderInstruction(url).textContent).toBe("Войдите в вашем браузере.");
    expect(
      screen.getByRole("link", { name: "вашем браузере" }).getAttribute("href"),
    ).toBe(url);
  });

  it("links the sign-in page in the Codex one-time code line", () => {
    const url = "https://auth.openai.com/codex/device";
    const onOpenUrl = vi.fn();
    const line = renderInstruction(url, {
      userCode: "JWMS-GLRCB",
      agentName: "Codex",
      onOpenUrl,
    });

    expect(line.textContent).toBe("Введите этот код на auth.openai.com.");
    expect(within(line).queryByRole("button")).toBeNull();
    const link = screen.getByRole("link", { name: "auth.openai.com" });
    expect(link.getAttribute("href")).toBe(url);
    fireEvent.click(link);
    expect(onOpenUrl).toHaveBeenCalledExactlyOnceWith(url);
  });
});

describe("AgentSignInPanel", () => {
  it("holds only the controls, not the instruction or a waiting line", () => {
    render(
      <AgentSignInPanel
        connect={false}
        agentName="Claude Code"
        view={{
          guide: {
            url: "https://claude.ai/oauth/authorize",
            userCode: null,
            acceptsPastedCode: true,
          },
          terminalVisible: false,
          started: true,
        }}
        code=""
        codeSubmitted={false}
        terminal={null}
        onCodeChange={vi.fn()}
        onSubmitCode={vi.fn()}
        onCopy={vi.fn()}
        onToggleTerminal={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("textbox", { name: "Код авторизации Claude Code" }),
    ).toBeTruthy();
    expect(screen.queryByText(/paste the code it shows you/u)).toBeNull();
    expect(screen.queryByText(/continues automatically/u)).toBeNull();
  });

  it("keeps the Codex sign-in link out of the panel toolbar", () => {
    render(
      <AgentSignInPanel
        connect={false}
        agentName="Codex"
        view={{
          guide: {
            url: "https://auth.openai.com/oauth/authorize?state=abc",
            userCode: null,
            acceptsPastedCode: false,
          },
          terminalVisible: false,
          started: true,
        }}
        code=""
        codeSubmitted={false}
        terminal={null}
        onCodeChange={vi.fn()}
        onSubmitCode={vi.fn()}
        onCopy={vi.fn()}
        onToggleTerminal={vi.fn()}
      />,
    );

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("button", { name: "Скопировать ссылку" })).toBeNull();
    expect(screen.getByText("Показать терминал")).toBeTruthy();
  });

  it("leaves Pi's sign-in to its terminal even when Pi asks for a code", () => {
    render(
      <AgentSignInPanel
        connect
        agentName="Pi"
        view={{
          guide: {
            url: "https://claude.ai/oauth/authorize?code=true&state=abc",
            userCode: "ABCD-EFGH",
            acceptsPastedCode: true,
          },
          terminalVisible: true,
          started: true,
        }}
        code="pasted"
        codeSubmitted
        terminal={<div>pi terminal</div>}
        onCodeChange={vi.fn()}
        onSubmitCode={vi.fn()}
        onCopy={vi.fn()}
        onToggleTerminal={vi.fn()}
      />,
    );

    expect(screen.getByText("pi terminal")).toBeTruthy();
    expect(screen.getByText("Скрыть терминал")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByText("ABCD-EFGH")).toBeNull();
    expect(screen.queryByText("Завершаем вход…")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });
});

function renderQuiet(agents: OnboardingAgent[]) {
  const handlers = {
    onSignIn: vi.fn(),
    onInstall: vi.fn(),
    onViewInstallLog: vi.fn(),
    onCancelSignIn: vi.fn(),
    onRecheck: vi.fn(),
  };
  const view = render(
    <TooltipProvider>
      <AgentStep
        quiet
        machineName="bee"
        agents={agents}
        loadFailedMessage={null}
        {...handlers}
      />
    </TooltipProvider>,
  );
  return { ...view, handlers };
}

function rowOf(id: string): HTMLElement {
  const row = document.querySelector(`[data-agent-id="${id}"]`);
  if (!(row instanceof HTMLElement)) throw new Error(`no row for ${id}`);
  return row;
}

function hasSubtitle(id: string): boolean {
  const column = within(rowOf(id)).getByText(id).parentElement;
  return (column?.childElementCount ?? 0) > 1;
}

describe("AgentStep progress in the redesign", () => {
  it("tells Pi users to choose a provider in the terminal while signing in", () => {
    renderQuiet([
      { ...agent("pi", { status: "signingIn" }), setup: "connect" },
    ]);

    expect(
      within(rowOf("pi")).getByText("Выберите провайдера и войдите ниже."),
    ).toBeTruthy();
    within(rowOf("pi")).getByRole("button", {
      name: "Отменить вход в pi",
    });
  });

  it("drops subtitles the button already says and keeps informative ones", () => {
    renderQuiet([
      agent("claude-code", {
        status: "signIn",
        reason: "signedOut",
        canSignIn: true,
      }),
      {
        ...agent("pi", {
          status: "signIn",
          reason: "signedOut",
          canSignIn: true,
        }),
        setup: "connect",
      },
      agent("codex", { status: "install", canInstall: true }),
      agent("cursor", { status: "ready", detail: "me@example.com · Pro" }),
      agent("amp", { status: "update", detail: null, canInstall: true }),
    ]);

    expect(hasSubtitle("claude-code")).toBe(false);
    expect(hasSubtitle("pi")).toBe(false);
    expect(hasSubtitle("codex")).toBe(false);
    expect(hasSubtitle("cursor")).toBe(true);
    expect(hasSubtitle("amp")).toBe(true);
    within(
      document.querySelector<HTMLElement>('[data-agent-id="pi"]')!,
    ).getByRole("button", { name: "Войти" });
    expect(screen.getByText("me@example.com · Pro")).toBeTruthy();
    expect(screen.getByText("Требуется обновление")).toBeTruthy();
    expect(
      screen.queryByText(/not signed in|Not installed|no model/u),
    ).toBeNull();
  });

  it("leaves a ready agent without account detail to its Ready label", () => {
    renderQuiet([
      agent("claude-code", { status: "ready", detail: null }),
      agent("cursor", { status: "ready", detail: "you@example.com · Pro" }),
      { ...agent("pi", { status: "ready", detail: null }), setup: "connect" },
    ]);

    expect(hasSubtitle("claude-code")).toBe(false);
    within(rowOf("claude-code")).getByText("Готов");
    expect(screen.queryByText("Вход выполнен")).toBeNull();
    within(rowOf("cursor")).getByText("you@example.com · Pro");
    expect(hasSubtitle("pi")).toBe(false);
    within(rowOf("pi")).getByText("Готов");
  });

  it("shows Installing… in the same disabled button", () => {
    const { rerender } = renderQuiet([
      agent("codex", { status: "install", canInstall: true }),
    ]);
    screen.getByRole("button", { name: "Установить" });

    rerender(
      <TooltipProvider>
        <AgentStep
          quiet
          machineName="bee"
          agents={[agent("codex", { status: "installing", update: false })]}
          loadFailedMessage={null}
          onSignIn={vi.fn()}
          onInstall={vi.fn()}
          onViewInstallLog={vi.fn()}
          onCancelSignIn={vi.fn()}
          onRecheck={vi.fn()}
        />
      </TooltipProvider>,
    );
    const busy = screen.getByRole("button", { name: "Установка…" });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    expect(busy.querySelector('[data-icon="Spinner"]')).not.toBeNull();
    expect(busy.textContent).toBe("Установка…");
  });

  it("shows Updating… while an update installs", () => {
    renderQuiet([agent("codex", { status: "installing", update: true })]);
    const busy = screen.getByRole("button", { name: "Обновление…" });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows Starting sign in… and no empty panel until the sign-in instruction is known", () => {
    renderQuiet([
      {
        ...agent("claude-code", { status: "signingIn" }),
        expanded: (
          <AgentSignInPanel
            connect={false}
            agentName="claude-code"
            view={{ guide: null, terminalVisible: false, started: false }}
            code=""
            codeSubmitted={false}
            terminal={null}
            onCodeChange={vi.fn()}
            onSubmitCode={vi.fn()}
            onCopy={vi.fn()}
            onToggleTerminal={vi.fn()}
          />
        ),
      },
    ]);

    within(rowOf("claude-code")).getByRole("button", {
      name: "Отменить вход в claude-code",
    });
    expect(screen.queryByRole("button", { name: "Starting…" })).toBeNull();
    const loading = within(rowOf("claude-code")).getByText("Начинаем вход…");
    expect(
      loading.closest("span.flex")?.querySelector('[data-icon="Spinner"]'),
    ).not.toBeNull();
    expect(
      within(rowOf("claude-code")).queryByText("Показать терминал"),
    ).toBeNull();
    expect(rowOf("claude-code").childElementCount).toBe(1);
  });

  it("spins beside the sign-in line once it is known", () => {
    renderQuiet([
      {
        ...agent("claude-code", { status: "signingIn" }),
        subline: "Finish signing in on claude.ai.",
      },
    ]);
    screen.getByRole("button", { name: "Отменить вход в claude-code" });
    const subtitle = screen.getByText("Finish signing in on claude.ai.");
    expect(
      subtitle.closest("span.flex")?.querySelector('[data-icon="Spinner"]'),
    ).not.toBeNull();
  });

  it("keeps the control guide's subtitles", () => {
    renderAgents([
      agent("claude-code", {
        status: "signIn",
        reason: "signedOut",
        canSignIn: true,
      }),
      agent("pi", { status: "installing", update: false }),
      agent("codex", { status: "ready", detail: null }),
    ]);
    expect(screen.getByText("Установлен · вход не выполнен")).toBeTruthy();
    expect(screen.getByText("Вход выполнен")).toBeTruthy();
    expect(screen.getByText("Установка…")).toBeTruthy();
  });
});

describe("Agent step header and install details in the redesign", () => {
  it("shows the machine line without Check again", () => {
    renderQuiet([agent("codex", { status: "install", canInstall: true })]);
    expect(screen.getByText("На компьютере bee")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Check again/u })).toBeNull();
  });

  it("opens the install output from the details strip", () => {
    render(<AgentInstallErrorDetails log="npm ERR! code ECONNRESET" />);
    expect(screen.queryByText("npm ERR! code ECONNRESET")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Показать подробности/u }));
    expect(screen.getByText("npm ERR! code ECONNRESET")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Скрыть подробности/u }));
    expect(screen.queryByText("npm ERR! code ECONNRESET")).toBeNull();
  });

  it("shows the install output without terminal escape codes and wraps long lines", () => {
    render(
      <AgentInstallErrorDetails
        log={"\u001b[31mnpm error\u001b[39m code ECONNREFUSED\r\n"}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Показать подробности/u }));
    const output = screen.getByText(/npm error code ECONNREFUSED/u);
    expect(output.textContent).toBe("npm error code ECONNREFUSED\n");
    expect(output.className).toContain("wrap-anywhere");
  });

  it("hides the old failure details while a retry waits", () => {
    const failed = {
      ...agent("codex", {
        status: "installFailed",
        message: "Couldn't install.",
        canInstall: true,
      }),
      installLog: "npm error code ECONNREFUSED",
    };
    const { rerender, handlers } = renderQuiet([failed]);
    within(rowOf("codex")).getByRole("button", { name: /Показать подробности/u });

    rerender(
      <TooltipProvider>
        <AgentStep
          quiet
          machineName="bee"
          agents={[
            {
              ...failed,
              state: { status: "installing", update: false },
              installQueued: true,
            },
          ]}
          loadFailedMessage={null}
          {...handlers}
        />
      </TooltipProvider>,
    );
    within(rowOf("codex")).getByRole("button", { name: "Ожидание…" });
    expect(
      within(rowOf("codex")).queryByRole("button", { name: /Показать подробности/u }),
    ).toBeNull();
  });
});

describe("Agent rows active at once in the redesign", () => {
  it("shows a queued install as Waiting… behind the running one", () => {
    renderQuiet([
      agent("pi", { status: "installing", update: false }),
      {
        ...agent("codex", { status: "installing", update: false }),
        installQueued: true,
      },
    ]);

    within(rowOf("pi")).getByRole("button", { name: "Установка…" });
    const waiting = within(rowOf("codex")).getByRole("button", {
      name: "Ожидание…",
    });
    expect((waiting as HTMLButtonElement).disabled).toBe(true);
    expect(waiting.querySelector('[data-icon="Spinner"]')).not.toBeNull();
  });
});

describe("RedesignedDevicesStep", () => {
  it("hides the machine section until bb connect is on", () => {
    const props = {
      hostName: "bee",
      connectSection: <li>bb connect</li>,
      addMachinePanel: null,
      onAddMachine: vi.fn(),
      onCloseAddMachine: vi.fn(),
    };
    const { rerender } = render(
      <TooltipProvider>
        <RedesignedDevicesStep {...props} showMachines={false} />
      </TooltipProvider>,
    );
    expect(screen.queryByText("Где работают агенты")).toBeNull();
    expect(screen.queryByText("Добавить компьютер")).toBeNull();
    expect(screen.getByText("Где вы используете bb").className).toContain("sr-only");

    rerender(
      <TooltipProvider>
        <RedesignedDevicesStep {...props} showMachines />
      </TooltipProvider>,
    );
    screen.getByText("Где работают агенты");
    expect(screen.getByText("Где вы используете bb").className).not.toContain(
      "sr-only",
    );
    expect(
      screen
        .getByText("bb connect")
        .compareDocumentPosition(screen.getByRole("button", { name: "Добавить компьютер" })) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Добавить компьютер" }));
    expect(props.onAddMachine).toHaveBeenCalledOnce();
  });

  it("adds no row of its own when bb connect contributes nothing", () => {
    render(
      <TooltipProvider>
        <RedesignedDevicesStep
          hostName="bee"
          connectSection={null}
          showMachines={false}
          addMachinePanel={null}
          onAddMachine={vi.fn()}
          onCloseAddMachine={vi.fn()}
        />
      </TooltipProvider>,
    );

    expect(screen.queryByText("Где вы используете bb")).toBeNull();
    expect(screen.queryByText(/turned off on this server/u)).toBeNull();
    expect(screen.queryByText("Добавить компьютер")).toBeNull();
    expect(screen.queryByText("Установить мобильное приложение")).toBeNull();
  });
});
