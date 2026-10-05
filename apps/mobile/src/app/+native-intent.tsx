// Not a screen: appduct's pairing link must not also navigate to "/" and yank the app off its screen.
export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }) {
  try {
    if (isAppductPairingLink(path)) {
      // A cold start through the link opens the home screen; a running app stays put.
      return initial ? "/" : null;
    }
  } catch {
    // Never let a malformed URL crash startup; fall through to normal routing.
  }
  return path;
}

export function isAppductPairingLink(path: string): boolean {
  const query = path.split("#")[0]?.split("?")[1];
  if (!query) return false;
  return query.split("&").some((pair) => pair.split("=")[0] === "appduct");
}
