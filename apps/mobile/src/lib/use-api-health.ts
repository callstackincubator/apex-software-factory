import type { ApiClient } from "@apex/contract";
import { useCallback, useEffect, useState } from "react";

export type ApiHealth =
  | { state: "checking" }
  | { state: "ok"; version: string; latencyMs: number }
  | { state: "offline" };

/** Monotonic milliseconds (what `performance.now` gives). Injectable so a test fixes the time. */
export type Clock = () => number;

/** The clock the app measures a round trip with. Pass a stable one to `useApiHealth`. */
export const defaultClock: Clock = () => performance.now();

/** An unreachable LAN address can hang for a minute; give up well before that. */
const TIMEOUT_MS = 5000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${ms} ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * One `/health` request, read the way the status footer shows it: any failure
 * — network, non-2xx, contract mismatch, timeout — is "offline", because the
 * API is optional for this app. An answer carries the round trip in whole
 * milliseconds, measured from just before the call to the parsed answer.
 * Also what the `api_health` agent tool returns.
 */
export async function checkApiHealth(
  client: Pick<ApiClient, "health">,
  now: Clock = defaultClock,
): Promise<Exclude<ApiHealth, { state: "checking" }>> {
  const startedAt = now();
  try {
    const { version } = await withTimeout(client.health(), TIMEOUT_MS);
    return { state: "ok", version, latencyMs: Math.round(now() - startedAt) };
  } catch {
    return { state: "offline" };
  }
}

/** Asks the API for `/health` once on mount and again whenever `refresh` is called. */
export function useApiHealth(client: Pick<ApiClient, "health">, now: Clock = defaultClock) {
  const [health, setHealth] = useState<ApiHealth>({ state: "checking" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    void checkApiHealth(client, now).then((result) => active && setHealth(result));
    return () => {
      active = false;
    };
  }, [client, attempt, now]);

  const refresh = useCallback(() => {
    setHealth({ state: "checking" });
    setAttempt((n) => n + 1);
  }, []);
  return { health, refresh };
}
