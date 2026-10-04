import { type SitemapType, usePathname, useSitemap } from "expo-router";
import { useEffect } from "react";

/**
 * Where the app is and where it can go, mirrored out of Expo Router for the
 * agent tools (which run outside React). `useTrackNavigation` in the root
 * layout keeps it current.
 */
export type NavigationState = {
  /** The focused route's path, e.g. `/` or `/features/12`. */
  pathname: string;
  /** Every screen route, as Expo Router names it: `/`, `/features/[id]`. */
  routes: string[];
};

let state: NavigationState = { pathname: "/", routes: [] };
const listeners = new Set<(next: NavigationState) => void>();

export function getNavigationState(): NavigationState {
  return state;
}

export function setNavigationState(next: NavigationState): void {
  state = next;
  for (const listener of listeners) listener(next);
}

/**
 * Resolves with the pathname once the app has navigated to `pathname`, or
 * with wherever it is when `timeoutMs` runs out.
 */
export function waitForPathname(pathname: string, timeoutMs: number): Promise<string> {
  if (state.pathname === pathname) return Promise.resolve(pathname);
  return new Promise((resolve) => {
    const done = (value: string) => {
      clearTimeout(timer);
      listeners.delete(listener);
      resolve(value);
    };
    const listener = (next: NavigationState) => {
      if (next.pathname === pathname) done(pathname);
    };
    const timer = setTimeout(() => done(state.pathname), timeoutMs);
    listeners.add(listener);
  });
}

/** Route groups (`(tabs)`) are not part of a URL. */
const stripGroups = (href: string) =>
  href
    .split("/")
    .filter((segment) => !/^\(.+\)$/.test(segment))
    .join("/") || "/";

/** The screen routes in a sitemap: leaves only, without `_sitemap` / `+not-found`. */
export function collectRoutes(node: SitemapType | null): string[] {
  if (!node) return [];
  const routes = new Set<string>();
  const visit = (current: SitemapType) => {
    if (current.children.length > 0) {
      current.children.forEach(visit);
      return;
    }
    if (current.isInternal || current.isGenerated || typeof current.href !== "string") return;
    routes.add(stripGroups(current.href));
  };
  visit(node);
  return [...routes].sort();
}

function routePattern(route: string): RegExp {
  const body = route
    .split("/")
    .map((segment) => {
      if (/^\[\.\.\..+\]$/.test(segment)) return ".+";
      if (/^\[.+\]$/.test(segment)) return "[^/]+";
      return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  return new RegExp(`^${body}$`);
}

/** The route that would render `path` (query string ignored), or null for none. */
export function matchRoute(path: string, routes: readonly string[]): string | null {
  const pathname = path.split("?")[0] || "/";
  // Static routes win over dynamic ones, as in Expo Router.
  const ordered = [...routes].sort((a, b) => Number(a.includes("[")) - Number(b.includes("[")));
  return ordered.find((route) => routePattern(route).test(pathname)) ?? null;
}

/** Mirrors the router into `getNavigationState()`. Call once, in the root layout. */
export function useTrackNavigation(): void {
  const pathname = usePathname();
  const sitemap = useSitemap();
  useEffect(() => {
    // An unmatched route reports its path without the leading slash.
    const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
    setNavigationState({ pathname: path, routes: collectRoutes(sitemap) });
  }, [pathname, sitemap]);
}
