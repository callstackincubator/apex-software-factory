import { HotUpdater } from "@hot-updater/react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import { UPDATE_STRATEGY } from "@/lib/ota";

/** How often a foregrounded app asks the OTA server for a newer bundle. */
export const CHECK_INTERVAL_MS = 30_000;

/** A bundle that is downloaded and staged, waiting for a reload to run. */
export type ReadyUpdate = {
  id: string;
  /** The deploy message (`ota:deploy -m`), i.e. the merge commit subject. */
  message: string | null;
  /** The server is taking a bad bundle back rather than shipping a new one. */
  rollback: boolean;
};

/**
 * Checks for a new OTA bundle on mount, whenever the app comes back to the
 * foreground, and every `intervalMs` while it is in the foreground. A bundle
 * is downloaded in the background and returned as `ready` once it is staged;
 * the caller decides when to `reload` into it. A force update (`deploy -f`, or
 * a rollback of the running bundle) reloads at once.
 *
 * A failed check or download is silent: the next tick tries again.
 */
export function useOtaUpdate(intervalMs = CHECK_INTERVAL_MS) {
  const [ready, setReady] = useState<ReadyUpdate | null>(null);
  const stagedId = useRef<string | null>(null);
  const checking = useRef(false);

  useEffect(() => {
    let active = true;

    async function check() {
      if (checking.current || AppState.currentState === "background") return;
      checking.current = true;
      try {
        const update = await HotUpdater.checkForUpdate({ updateStrategy: UPDATE_STRATEGY });
        // The server keeps offering a staged bundle until the app reloads into it.
        if (!update || update.id === stagedId.current) return;
        if (!(await update.updateBundle())) return;
        stagedId.current = update.id;
        if (update.shouldForceUpdate) {
          await HotUpdater.reload();
          return;
        }
        if (active) {
          setReady({
            id: update.id,
            message: update.message ?? null,
            rollback: update.status === "ROLLBACK",
          });
        }
      } catch {
        // Offline, server down, download failed: try again on the next tick.
      } finally {
        checking.current = false;
      }
    }

    void check();
    const timer = setInterval(() => void check(), intervalMs);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void check();
    });
    return () => {
      active = false;
      clearInterval(timer);
      subscription.remove();
    };
  }, [intervalMs]);

  const reload = useCallback(() => HotUpdater.reload(), []);
  return { ready, reload };
}
