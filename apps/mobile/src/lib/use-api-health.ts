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
 * Asks the API for `/health` once on mount and again whenever `refresh` is
 * called. Any failure — network, non-2xx, contract mismatch, timeout — reads
 * as "offline": the API is optional for this app.
 */
export function useApiHealth(client: Pick<ApiClient, "health">) {
  const [health, setHealth] = useState<ApiHealth>({ state: "checking" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    withTimeout(client.health(), TIMEOUT_MS).then(
      ({ version }) => active && setHealth({ state: "ok", version }),
      () => active && setHealth({ state: "offline" }),
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
