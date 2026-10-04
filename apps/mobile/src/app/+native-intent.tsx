/**
 * Not a screen: Expo Router's hook for rewriting incoming deep links
 * (`+native-intent`). appduct pairs an agent with the app through a one-time
 * link, `apexfactory:///?appduct=<payload>&pin=sha256/…`, which appduct's own
 * listener consumes. Without this, Expo Router would also treat it as a
 * navigation to `/` and yank the app off whatever screen it is on.
 */
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

/** True for appduct's pairing link: an `appduct` query parameter, on any path. */
export function isAppductPairingLink(path: string): boolean {
  const query = path.split("#")[0]?.split("?")[1];
  if (!query) return false;
  return query.split("&").some((pair) => pair.split("=")[0] === "appduct");
}
