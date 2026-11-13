// @vitest-environment jsdom

import { PluginCardAuthor } from "./PluginCard";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginCatalogSearchEntry } from "@/hooks/queries/plugin-catalog-queries";
import { PluginMoreFromAuthorSection } from "./PluginMarketplaceListing";

function catalogEntry(pluginId: string): PluginCatalogSearchEntry {
  return {
    entryId: pluginId,
    pluginId,
    displayName: pluginId,
    description: `${pluginId} description`,
    icon: "Zap",
    iconUrl: null,
    iconTinted: false,
    screenshots: [],
    collections: [],
    source: `npm:${pluginId}`,
    repositoryUrl: null,
    marketplace: "bb-community",
    marketplaceDisplayName: "BB Community",
    publisherKey: "bb-community",
    publisherLabel: "BB Community",
    official: true,
    author: {
      name: "Pat Lee",
      github: "patlee",
      url: "https://github.com/patlee",
    },
    installed: false,
    conflictingInstallSource: null,
    installedByDefault: false,
    installs: null,
    compatible: true,
    incompatibleReason: null,
  };
}

afterEach(cleanup);

describe("plugin marketplace author links", () => {
  it("routes the detail author name to the author page", () => {
    render(
      <MemoryRouter initialEntries={["/plugins/Current?category=security"]}>
        <PluginCardAuthor entry={catalogEntry("Текущая версия")} />
      </MemoryRouter>,
    );

    expect(screen.queryByText(/^By/u)).toBeNull();
    expect(
      screen.getByRole("link", { name: "Pat Lee" }).getAttribute("href"),
    ).toBe(
      "/plugins?category=security&author=12%3Abb-community%3Agithub%3Apatlee",
    );
  });

  it("excludes the current plugin and caps plain teaser rows at four", () => {
    const current = catalogEntry("Текущая версия");
    const entries = [
      current,
      catalogEntry("Echo"),
      catalogEntry("Delta"),
      catalogEntry("Charlie"),
      catalogEntry("Bravo"),
      catalogEntry("Alpha"),
      {
        ...catalogEntry("Other"),
        author: { name: "Other", github: null, url: null },
      },
    ];
    const onOpenPlugin = vi.fn();
    render(
      <MemoryRouter>
        <PluginMoreFromAuthorSection
          entry={current}
          catalogEntries={entries}
          onOpenPlugin={onOpenPlugin}
        />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("heading", { name: "Другие плагины автора" }),
    ).toBeTruthy();
    expect(
      screen
        .getAllByRole("button", { name: /^Открыть сведения о .+$/u })
        .map((button) => button.getAttribute("aria-label")),
    ).toEqual([
      "Открыть сведения о Alpha",
      "Открыть сведения о Bravo",
      "Открыть сведения о Charlie",
      "Открыть сведения о Delta",
    ]);
    expect(screen.queryByText("Текущая версия")).toBeNull();
    expect(screen.queryByText("Echo")).toBeNull();
    expect(screen.queryByText("Other")).toBeNull();
    expect(screen.queryByRole("button", { name: /install/i })).toBeNull();
    expect(screen.queryByText(/trusted|official|installed/iu)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Открыть сведения о Alpha" }));
    expect(onOpenPlugin).toHaveBeenCalledWith("Alpha");
  });
});
