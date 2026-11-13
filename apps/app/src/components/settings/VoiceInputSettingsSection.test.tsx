// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VoiceInputSettingsSectionContent } from "./VoiceInputSettingsSection";

const devices = [
  { deviceId: "macbook-mic", label: "MacBook Pro Microphone" },
  { deviceId: "studio-mic", label: "Studio Display Microphone" },
];

afterEach(() => {
  cleanup();
});

describe("VoiceInputSettingsSectionContent", () => {
  it("keeps the refresh action inline with the heading on mobile", () => {
    render(
      <TooltipProvider>
        <VoiceInputSettingsSectionContent
          devices={devices}
          errorMessage={null}
          isLoading={false}
          isSupported={true}
          onRefresh={() => undefined}
          preferredDeviceId={null}
        />
      </TooltipProvider>,
    );

    const refreshAction = screen.getByRole("button", {
      name: "Загрузить микрофоны",
    });
    const sectionHeader = refreshAction.parentElement?.parentElement;
    expect(sectionHeader?.classList.contains("flex-row")).toBe(true);
    expect(sectionHeader?.classList.contains("flex-col")).toBe(false);
  });

  it("falls back when the preferred microphone disconnects and restores it on reconnect", () => {
    const content = (availableDevices: typeof devices) => (
      <TooltipProvider>
        <VoiceInputSettingsSectionContent
          devices={availableDevices}
          errorMessage={null}
          isLoading={false}
          isSupported={true}
          onRefresh={() => undefined}
          preferredDeviceId="studio-mic"
        />
      </TooltipProvider>
    );
    const { rerender } = render(content(devices));
    expect(screen.getByRole("button", { name: "Микрофон" }).textContent).toBe(
      "Studio Display Microphone",
    );

    rerender(
      content(devices.filter((device) => device.deviceId !== "studio-mic")),
    );
    expect(screen.getByRole("button", { name: "Микрофон" }).textContent).toBe(
      "Системный по умолчанию",
    );
    expect(
      screen.getByText(
        "Предпочтительный микрофон отключён. До его подключения используется другой вход.",
      ),
    ).toBeDefined();

    rerender(content([]));
    expect(
      screen.getByRole("button", { name: "Проверить доступ к микрофону" }),
    ).toBeDefined();

    rerender(content(devices));
    expect(screen.getByRole("button", { name: "Микрофон" }).textContent).toBe(
      "Studio Display Microphone",
    );
  });

  it("shows the device error it is given when no microphone is listed", () => {
    render(
      <TooltipProvider>
        <VoiceInputSettingsSectionContent
          devices={[]}
          errorMessage="Microphone permission denied"
          isLoading={false}
          isSupported={true}
          onRefresh={() => undefined}
          preferredDeviceId={null}
        />
      </TooltipProvider>,
    );
    expect(screen.getByText("Microphone permission denied")).toBeDefined();
  });

  it("checks microphone access from the inline action", () => {
    const onRefresh = vi.fn();
    render(
      <TooltipProvider>
        <VoiceInputSettingsSectionContent
          devices={[]}
          errorMessage={null}
          isLoading={false}
          isSupported={true}
          onRefresh={onRefresh}
          preferredDeviceId={null}
        />
      </TooltipProvider>,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Проверить доступ к микрофону" }),
    );
    expect(onRefresh).toHaveBeenCalledExactlyOnceWith(true);
  });
});
