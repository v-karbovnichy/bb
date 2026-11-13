// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ThreadModelFallbackCard } from "./ThreadModelFallbackCard";

const fallback = {
  sourceSeq: 42,
  detectedAt: 123,
  originalModel: "claude-fable-5",
  fallbackModel: "claude-opus-4-8",
  reason: "refusal" as const,
  message: "Fable refused this request. Switched to Opus.",
};

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("ThreadModelFallbackCard", () => {
  it("renders as a compact prompt-stack card and persists dismissal", () => {
    const first = render(
      <ThreadModelFallbackCard fallback={fallback} threadId="thread-1" />,
    );

    expect(screen.getByText("Резервная модель")).toBeTruthy();
    expect(screen.getByText("Переключено с Fable 5 на Opus 4.8")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Скрыть уведомление о резервной модели" }),
    );
    expect(screen.queryByText("Резервная модель")).toBeNull();

    first.unmount();
    render(<ThreadModelFallbackCard fallback={fallback} threadId="thread-1" />);
    expect(screen.queryByText("Резервная модель")).toBeNull();
  });

  it("shows a later fallback occurrence after an earlier one was dismissed", () => {
    window.localStorage.setItem(
      "bb.thread.model-fallback-dismissed.thread-1",
      "42",
    );

    render(
      <ThreadModelFallbackCard
        fallback={{ ...fallback, sourceSeq: 43 }}
        threadId="thread-1"
      />,
    );
    expect(screen.getByText("Резервная модель")).toBeTruthy();
  });
});
