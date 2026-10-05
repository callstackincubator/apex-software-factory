import { type SitemapType, usePathname, useSitemap } from "expo-router";
import { useEffect } from "react";

// Mirrors Expo Router for the agent tools, which run outside React.
export type NavigationState = {
  pathname: string;
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

const stripGroups = (href: string) =>
  href
    .split("/")
    .filter((segment) => !/^\(.+\)$/.test(segment))
    .join("/") || "/";

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

export function matchRoute(path: string, routes: readonly string[]): string | null {
  const pathname = path.split("?")[0] || "/";
  // Static routes win over dynamic ones, as in Expo Router.
  const ordered = [...routes].sort((a, b) => Number(a.includes("[")) - Number(b.includes("[")));
  return ordered.find((route) => routePattern(route).test(pathname)) ?? null;
}

export function useTrackNavigation(): void {
  const pathname = usePathname();
  const sitemap = useSitemap();
  useEffect(() => {
    // An unmatched route reports its path without the leading slash.
    const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
    setNavigationState({ pathname: path, routes: collectRoutes(sitemap) });
  }, [pathname, sitemap]);
}
