import { describe, expect, it } from "vitest";
import {
  resolvePluginsWorkspaceHeaderMeta,
  resolveSkillsWorkspaceHeaderMeta,
  resolveToolsBreadcrumbs,
} from "@/components/tools/tools-navigation";

describe("resolveToolsBreadcrumbs", () => {
  it("includes the selected collection tab", () => {
    expect(resolveToolsBreadcrumbs("/skills")).toEqual([
      { label: "Навыки", to: "/skills" },
      { label: "Обзор" },
    ]);
    expect(resolveToolsBreadcrumbs("/skills", "?view=library")).toEqual([
      { label: "Навыки", to: "/skills" },
      { label: "Мои навыки" },
    ]);
    expect(resolveToolsBreadcrumbs("/plugins")).toEqual([
      { label: "Плагины", to: "/plugins" },
      { label: "Обзор" },
    ]);
    expect(resolveToolsBreadcrumbs("/plugins", "?view=create")).toEqual([
      { label: "Плагины", to: "/plugins" },
      { label: "Создать плагин" },
    ]);
    expect(resolveToolsBreadcrumbs("/plugins", "?view=installed")).toEqual([
      { label: "Плагины", to: "/plugins" },
      { label: "Установленные" },
    ]);
  });

  it("resolves the Skills registry path as Browse", () => {
    expect(resolveToolsBreadcrumbs("/skills/registry")).toEqual([
      { label: "Навыки", to: "/skills" },
      { label: "Обзор" },
    ]);
  });

  it("makes every detail ancestor clickable and keeps the resource passive", () => {
    expect(
      resolveToolsBreadcrumbs(
        "/skills/library/skill_abc123",
        "",
        "Example Skill",
      ),
    ).toEqual([
      { label: "Навыки", to: "/skills" },
      { label: "Мои навыки", to: "/skills?view=library" },
      { label: "Example Skill" },
    ]);
    expect(
      resolveToolsBreadcrumbs(
        "/skills/registry/vercel-labs%2Fskills%2Ffind-skills",
      ),
    ).toEqual([
      { label: "Навыки", to: "/skills" },
      { label: "Обзор", to: "/skills/registry" },
      { label: "find-skills" },
    ]);
    expect(resolveToolsBreadcrumbs("/plugins/ui-patterns")).toEqual([
      { label: "Плагины", to: "/plugins" },
      { label: "Обзор", to: "/plugins" },
      { label: "ui-patterns" },
    ]);
    expect(
      resolveToolsBreadcrumbs(
        "/plugins/ui-patterns",
        "?view=installed",
        "UI Patterns",
      ),
    ).toEqual([
      { label: "Плагины", to: "/plugins" },
      { label: "Установленные", to: "/settings/plugins" },
      { label: "UI Patterns" },
    ]);
    expect(
      resolveToolsBreadcrumbs(
        "/plugins/automations/automations/personal/weekly-review",
      ),
    ).toBeNull();
  });
});

describe("resource workspace headers", () => {
  it("gives Plugins ownership of only the Plugins header", () => {
    expect(
      resolvePluginsWorkspaceHeaderMeta(
        "/plugins?view=installed".split("?")[0]!,
      ),
    ).toEqual({ kind: "section-title", title: "Плагины" });
    expect(resolvePluginsWorkspaceHeaderMeta("/skills/registry")).toBeNull();
  });

  it("gives Skills ownership of only the Skills header", () => {
    expect(resolveSkillsWorkspaceHeaderMeta("/skills/registry")).toEqual({
      kind: "section-title",
      title: "Навыки",
    });
    expect(resolveSkillsWorkspaceHeaderMeta("/plugins")).toBeNull();
  });

  it("keeps plugin creation inside the Plugins header", () => {
    expect(
      resolvePluginsWorkspaceHeaderMeta("/plugins", "?view=create"),
    ).toEqual({
      kind: "breadcrumbs",
      breadcrumbs: [
        { label: "Плагины", to: "/plugins" },
        { label: "Создать плагин" },
      ],
    });
  });

  it("claims nothing outside either resource workspace", () => {
    expect(resolvePluginsWorkspaceHeaderMeta("/")).toBeNull();
    expect(resolveSkillsWorkspaceHeaderMeta("/")).toBeNull();
  });
});
