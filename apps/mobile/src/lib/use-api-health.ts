import type { ApiClient } from "@apex/contract";
import { useCallback, useEffect, useState } from "react";

export type ApiHealth =
  | { state: "checking" }
  | { state: "ok"; version: string }
  | { state: "offline" };

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
 * API is optional for this app. Also what the `api_health` agent tool returns.
 */
export async function checkApiHealth(
  client: Pick<ApiClient, "health">,
): Promise<Exclude<ApiHealth, { state: "checking" }>> {
  try {
    const { version } = await withTimeout(client.health(), TIMEOUT_MS);
    return { state: "ok", version };
  } catch {
    return { state: "offline" };
  }
}

/** Asks the API for `/health` once on mount and again whenever `refresh` is called. */
export function useApiHealth(client: Pick<ApiClient, "health">) {
  const [health, setHealth] = useState<ApiHealth>({ state: "checking" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    void checkApiHealth(client).then((result) => active && setHealth(result));
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
