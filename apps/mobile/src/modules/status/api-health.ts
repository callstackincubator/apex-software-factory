import { useCallback, useEffect, useState } from "react";

import { getApiClient } from "@/modules/api";

export type ApiHealth =
  | { state: "checking" }
  | { state: "ok"; version: string }
  | { state: "offline" };

// An unreachable LAN address can hang for a minute.
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

export async function checkApiHealth(): Promise<Exclude<ApiHealth, { state: "checking" }>> {
  try {
    const { version } = await withTimeout(getApiClient().health(), TIMEOUT_MS);
    return { state: "ok", version };
  } catch {
    return { state: "offline" };
  }
}

export function useApiHealth() {
  const [health, setHealth] = useState<ApiHealth>({ state: "checking" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    void checkApiHealth().then((result) => active && setHealth(result));
    return () => {
      active = false;
    };
  }, [attempt]);

  const refresh = useCallback(() => {
    setHealth({ state: "checking" });
    setAttempt((n) => n + 1);
  }, []);
  return { health, refresh };
}
