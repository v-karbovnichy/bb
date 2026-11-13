// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { afterEach, expect, it, vi } from "vitest";
import { VoiceInputButton } from "./VoiceInputButton";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it.each(["warning", "context menu", "keyboard"])(
  "opens microphone preferences from %s without recording or hiding the app",
  async (method) => {
    const record = vi.fn();
    const content = (warning: string | null) => (
      <TooltipProvider>
        <VoiceInputButton
          warning={warning}
          aria-label="Начать голосовой ввод"
          onClick={record}
        >
          Mic
        </VoiceInputButton>
      </TooltipProvider>
    );
    const { container, rerender } = render(
      content(method === "warning" ? "Microphone unavailable" : null),
    );
    const mic = screen.getByRole("button", {
      name:
        method === "warning"
          ? "Предупреждение микрофона: откройте настройки голосового ввода"
          : "Начать голосовой ввод",
    });
    expect(container.querySelectorAll("button")).toHaveLength(1);
    if (method === "warning") fireEvent.click(mic);
    if (method === "context menu") fireEvent.contextMenu(mic);
    if (method === "keyboard")
      fireEvent.keyDown(mic, { key: "F10", shiftKey: true });
    expect(
      await screen.findByRole("dialog", { name: "Настройки голосового ввода" }),
    ).toBeTruthy();
    expect(
      await screen.findByRole("button", { name: "Системный по умолчанию" }),
    ).toBeTruthy();
    expect(record).not.toHaveBeenCalled();
    expect(container.closest('[inert], [aria-hidden="true"]')).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Закрыть настройки голосового ввода" }),
    );
    rerender(content(null));
    fireEvent.click(screen.getByRole("button", { name: "Начать голосовой ввод" }));
    expect(record).toHaveBeenCalledOnce();
  },
);

it("shows a recurring capture error after preview recovery and another recording attempt", async () => {
  const stop = vi.fn();
  vi.stubGlobal("navigator", {
    mediaDevices: Object.assign(new EventTarget(), {
      enumerateDevices: vi
        .fn()
        .mockResolvedValue([
          { kind: "audioinput", deviceId: "mic", label: "Микрофон" },
        ]),
      getUserMedia: vi
        .fn()
        .mockResolvedValue({
          getTracks: () => [{ stop }],
          getAudioTracks: () => [{ label: "Микрофон" }],
        }),
    }),
  });
  const record = vi.fn();
  render(
    <TooltipProvider>
      <VoiceInputButton
        warning="Microphone unavailable"
        aria-label="Начать голосовой ввод"
        onClick={record}
      >
        Mic
      </VoiceInputButton>
    </TooltipProvider>,
  );
  fireEvent.click(
    screen.getByRole("button", {
      name: "Предупреждение микрофона: откройте настройки голосового ввода",
    }),
  );
  await screen.findByRole("button", { name: "Начать голосовой ввод" });
  fireEvent.click(
    screen.getByRole("button", { name: "Закрыть настройки голосового ввода" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Начать голосовой ввод" }));
  expect(record).toHaveBeenCalledOnce();
  expect(
    screen.getByRole("button", {
      name: "Предупреждение микрофона: откройте настройки голосового ввода",
    }),
  ).toBeTruthy();
  expect(stop).toHaveBeenCalledOnce();
});
