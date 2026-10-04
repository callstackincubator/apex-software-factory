import type { ApiClient } from "@apex/contract";
import { useCallback, useEffect, useState } from "react";

export type ApiHealth =
  | { state: "checking" }
  | { state: "ok"; version: string; latencyMs: number }
  | { state: "offline" };

/** An unreachable LAN address can hang for a minute; give up well before that. */
const TIMEOUT_MS = 5000;

/** The monotonic clock Hermes provides; injectable so tests fix the time. */
export function defaultClock(): number {
  return performance.now();
}

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
 * API is optional for this app. An "ok" answer carries the round trip of this
 * one request in whole milliseconds, measured on `now` from just before the
 * call to the parsed answer. Also what the `api_health` agent tool returns.
 */
export async function checkApiHealth(
  client: Pick<ApiClient, "health">,
  now: () => number = defaultClock,
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
export function useApiHealth(client: Pick<ApiClient, "health">, now?: () => number) {
  const [health, setHealth] = useState<ApiHealth>({ state: "checking" });
  const [attempt, setAttempt] = useState(0);
  // The clock is fixed for the hook's life: a caller passing an inline
  // function each render must not re-trigger the check.
  const [clock] = useState(() => now ?? defaultClock);

  useEffect(() => {
    let active = true;
    void checkApiHealth(client, clock).then((result) => active && setHealth(result));
    return () => {
      active = false;
    };
  }, [client, attempt, clock]);

  const refresh = useCallback(() => {
    setHealth({ state: "checking" });
    setAttempt((n) => n + 1);
  }, []);
  return { health, refresh };
}
