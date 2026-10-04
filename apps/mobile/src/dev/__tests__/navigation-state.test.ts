import type { SitemapType } from "expo-router";

import {
  collectRoutes,
  matchRoute,
  setNavigationState,
  waitForPathname,
} from "@/dev/navigation-state";

function node(href: string, children: SitemapType[] = [], extra: Partial<SitemapType> = {}) {
  return {
    contextKey: href,
    filename: href,
    href,
    isInitial: false,
    isInternal: false,
    isGenerated: false,
    children,
    ...extra,
  } satisfies SitemapType;
}

describe("collectRoutes", () => {
  it("lists screen routes without layouts, route groups or Expo Router's own screens", () => {
    const sitemap = node("/", [
      node("/"),
      node("/(tabs)", [node("/(tabs)/settings"), node("/(tabs)/features/[id]")]),
      node("/_sitemap", [], { isInternal: true }),
      node("/+not-found", [], { isGenerated: true }),
    ]);

    expect(collectRoutes(sitemap)).toEqual(["/", "/features/[id]", "/settings"]);
  });

  it("returns nothing before the router has a sitemap", () => {
    expect(collectRoutes(null)).toEqual([]);
  });
});

describe("matchRoute", () => {
  const routes = ["/", "/features/[id]", "/features/new", "/docs/[...rest]"];

  it("prefers a static route over a dynamic one", () => {
    expect(matchRoute("/features/new", routes)).toBe("/features/new");
    expect(matchRoute("/features/12", routes)).toBe("/features/[id]");
  });

  it("matches catch-all routes across segments and ignores the query", () => {
    expect(matchRoute("/docs/a/b?x=1", routes)).toBe("/docs/[...rest]");
    expect(matchRoute("/?appduct=1", routes)).toBe("/");
  });

  it("matches nothing for an unknown path or a dynamic segment left empty", () => {
    expect(matchRoute("/nope", routes)).toBeNull();
    expect(matchRoute("/features/", routes)).toBeNull();
  });
});

describe("waitForPathname", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    setNavigationState({ pathname: "/", routes: [] });
  });
  afterEach(() => jest.useRealTimers());

  it("resolves once the app reaches the path", async () => {
    const arrived = waitForPathname("/settings", 3000);
    setNavigationState({ pathname: "/settings", routes: [] });

    await expect(arrived).resolves.toBe("/settings");
  });

  it("resolves with where the app is when the time runs out", async () => {
    const arrived = waitForPathname("/settings", 3000);
    jest.advanceTimersByTime(3000);

    await expect(arrived).resolves.toBe("/");
  });
});
