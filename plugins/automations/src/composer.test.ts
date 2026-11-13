import type { ComposerDraftSnapshot } from "@get-bb/plugin-sdk/app";
import { describe, expect, it } from "vitest";
import { withCreateAutomationPrompt } from "../composer.js";

describe("withCreateAutomationPrompt", () => {
  it("replaces a leading command, keeps later pills, and is idempotent", () => {
    const draft: ComposerDraftSnapshot = {
      text: "/plan check @spec daily",
      mentions: [
        {
          kind: "command",
          trigger: "/",
          name: "plan",
          source: "command",
          origin: "user",
          argumentHint: null,
          label: "plan",
          from: 0,
          to: 5,
        },
        { kind: "project", projectId: "p", label: "spec", from: 12, to: 17 },
      ],
      attachments: [],
    };

    const next = withCreateAutomationPrompt(draft);

    expect(next.text).toBe("Создай новую автоматизацию bb, которая check @spec daily");
    expect(next.mentions).toEqual([
      { kind: "project", projectId: "p", label: "spec", from: 45, to: 50 },
    ]);
    expect(withCreateAutomationPrompt({ ...draft, ...next })).toEqual(next);
  });
});
