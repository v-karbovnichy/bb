import { describe, expect, it } from "vitest";
import {
  buildSettingsSearchItems,
  readSettingsSearchAnchor,
  searchSettings,
  SETTINGS_SEARCH_ANCHOR_STATE_KEY,
} from "./settings-search";
import { SETTINGS_NAV_SECTIONS } from "./settings-sections";

const linearPlugin = {
  hasSettingsForm: true,
  icon: null,
  id: "linear",
  label: "Linear",
};

const linearSettings = [
  {
    description: "Used to read and update issues.",
    key: "apiKey",
    label: "API key",
    pluginId: "linear",
  },
  { description: null, key: "team", label: "Default team", pluginId: "linear" },
];

const allItems = buildSettingsSearchItems({
  conditions: new Set(["fileOpeners"]),
  pluginEntries: [linearPlugin],
  pluginSettings: linearSettings,
  sections: SETTINGS_NAV_SECTIONS,
});

function searchTitles(query: string, items = allItems): string[] {
  return searchSettings(query, items).map((item) =>
    item.context === null ? item.title : `${item.context} › ${item.title}`,
  );
}

describe("searchSettings", () => {
  it("returns nothing for a blank query", () => {
    expect(searchSettings("   ", allItems)).toEqual([]);
  });

  it("ranks a title match above settings that only mention the word", () => {
    expect(searchTitles("тема")).toEqual([
      "Внешний вид › Тема",
      "Внешний вид › Палитра",
    ]);
  });

  it("finds a setting by a word people remember instead of its title", () => {
    expect(searchTitles("telemetry")).toEqual([
      "Основные › Отправлять анонимные данные об использовании",
    ]);
    expect(searchTitles("dark mode")).toEqual(["Внешний вид › Тема"]);
    expect(searchTitles("idle timeout")).toEqual([
      "Провайдеры › Завершать неактивные сеансы агентов",
    ]);
  });

  it("matches words in any order and ignores case and extra spaces", () => {
    expect(searchTitles("  ПРЕФИКС   новой ")).toEqual([
      "Основные › Префикс новой ветки",
    ]);
  });

  it("ranks relevant results for a broad query", () => {
    expect(searchTitles("a").slice(0, 4)).toEqual([
      "Linear › API key",
      "Настройки плагина › Linear",
      "Linear › Default team",
      "Провайдеры",
    ]);
  });

  it("lists a section first, then the settings inside it", () => {
    const titles = searchTitles("эксперименты");
    expect(titles[0]).toBe("Эксперименты");
    expect(titles).toContain("Эксперименты › Перенос сервера");
  });

  it("points a setting at its section route and carries its anchor", () => {
    const [result] = searchSettings("значка", allItems);
    expect(result).toMatchObject({
      anchor: "Цвет значка вкладки",
      to: "/settings/appearance",
    });
  });

  it("finds plugin settings pages by name and by plugin id", () => {
    expect(searchSettings("lin", allItems)[0]).toMatchObject({
      anchor: null,
      title: "Linear",
      to: "/settings/plugins/linear",
    });
    expect(
      searchTitles(
        "acme",
        buildSettingsSearchItems({
          conditions: new Set(),
          pluginEntries: [
            {
              hasSettingsForm: false,
              icon: null,
              id: "acme-tracker",
              label: "Tracker",
            },
          ],
          pluginSettings: [],
          sections: [],
        }),
      ),
    ).toEqual(["Настройки плагина › Tracker"]);
  });

  it("finds a setting inside a plugin's page by its label, key or description", () => {
    expect(searchTitles("default team")).toEqual(["Linear › Default team"]);
    expect(searchTitles("apikey")).toEqual(["Linear › API key"]);
    expect(searchTitles("update issues")).toEqual(["Linear › API key"]);
    expect(searchSettings("api key", allItems)[0]).toMatchObject({
      anchor: "API key",
      to: "/settings/plugins/linear",
    });
  });

  it("lists a plugin's page before the settings inside it", () => {
    expect(searchTitles("linear")).toEqual([
      "Настройки плагина › Linear",
      "Основные › Ссылки приложений",
      "Linear › API key",
      "Linear › Default team",
    ]);
  });

  it("leaves out settings whose section is hidden", () => {
    const withoutFiles = buildSettingsSearchItems({
      conditions: new Set(["fileOpeners"]),
      pluginEntries: [],
      pluginSettings: [],
      sections: SETTINGS_NAV_SECTIONS.filter(
        (section) => section.id !== "files",
      ),
    });
    expect(searchTitles("открытие файлов")).toEqual(["Файлы › Открытие файлов"]);
    expect(searchTitles("открытие файлов", withoutFiles)).toEqual([]);
  });
});

describe("buildSettingsSearchItems", () => {
  it("offers a conditional setting only while its row is on the page", () => {
    const titles = (conditions: ("desktopBrowser" | "diffRenderers")[]) =>
      searchTitles(
        "встроенном браузере",
        buildSettingsSearchItems({
          conditions: new Set(conditions),
          pluginEntries: [],
          pluginSettings: [],
          sections: SETTINGS_NAV_SECTIONS,
        }),
      );

    expect(titles(["diffRenderers"])).toEqual([]);
    expect(titles(["desktopBrowser"])).toEqual([
      "Основные › Открывать ссылки во встроенном браузере",
    ]);
  });
});

describe("readSettingsSearchAnchor", () => {
  it("reads the anchor a search result put in the location state", () => {
    expect(
      readSettingsSearchAnchor({ [SETTINGS_SEARCH_ANCHOR_STATE_KEY]: "Тема" }),
    ).toBe("Тема");
  });

  it("ignores location state that belongs to something else", () => {
    expect(readSettingsSearchAnchor(null)).toBeNull();
    expect(readSettingsSearchAnchor({ focusPrompt: true })).toBeNull();
    expect(
      readSettingsSearchAnchor({ [SETTINGS_SEARCH_ANCHOR_STATE_KEY]: 4 }),
    ).toBeNull();
  });
});
