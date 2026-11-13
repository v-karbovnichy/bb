import { describe, expect, it } from "vitest";
import { buildAutomationEditThreadPrompt } from "../lib/edit-prompt.js";

describe("automation edit thread prompt", () => {
  it("gives the thread an unambiguous writable automation locator", () => {
    expect(
      buildAutomationEditThreadPrompt({
        name: "Daily triage",
        projectId: "proj_123",
        automationId: "auto_456",
      }),
    ).toBe(
      'Измени автоматизацию bb "Daily triage" (ID auto_456) в проекте proj_123. Я хочу ',
    );
  });
});
