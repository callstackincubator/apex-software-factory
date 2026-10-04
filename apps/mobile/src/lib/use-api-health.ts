import type { ApiClient } from "@apex/contract";
import { useCallback, useEffect, useRef, useState } from "react";

export type ApiHealth =
  | { state: "checking" }
  | { state: "ok"; version: string; latencyMs: number }
  | { state: "offline" };

/** An unreachable LAN address can hang for a minute; give up well before that. */
const TIMEOUT_MS = 5000;

/** The clock the health check reads when nothing else is handed it. */
export const systemNow = (): number => performance.now();

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
 * API is optional for this app. An "ok" answer carries `latencyMs`, the round
 * trip of this one request in whole milliseconds, measured from just before
 * the call to the parsed answer with `now` (a parameter so a test fixes it).
 * Also what the `api_health` agent tool returns.
 */
export async function checkApiHealth(
  client: Pick<ApiClient, "health">,
  now: () => number = systemNow,
): Promise<Exclude<ApiHealth, { state: "checking" }>> {
  try {
    const startedAt = now();
    const { version } = await withTimeout(client.health(), TIMEOUT_MS);
    return { state: "ok", version, latencyMs: Math.round(now() - startedAt) };
  } catch {
    return { state: "offline" };
  }
}

/** Asks the API for `/health` once on mount and again whenever `refresh` is called. */
export function useApiHealth(client: Pick<ApiClient, "health">, now: () => number = systemNow) {
  const [health, setHealth] = useState<ApiHealth>({ state: "checking" });
  const [attempt, setAttempt] = useState(0);
  // The clock through a ref so a caller passing a fresh closure per render
  // never re-runs the check; the check effect depends only on client and attempt.
  const clock = useRef(now);
  useEffect(() => {
    clock.current = now;
  }, [now]);

  useEffect(() => {
    let active = true;
    void checkApiHealth(client, () => clock.current()).then(
      (result) => active && setHealth(result),
    );
    return () => {
      active = false;
    };
  }, [client, attempt]);

  const refresh = useCallback(() => {
    setHealth({ state: "checking" });
    setAttempt((n) => n + 1);
  }, []);
  return { health, refresh };
}
