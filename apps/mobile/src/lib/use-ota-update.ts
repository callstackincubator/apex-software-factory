import { HotUpdater } from "@hot-updater/react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import { UPDATE_STRATEGY } from "@/lib/ota";
import {
  attachOtaControl,
  type CheckOutcome,
  notifyUpdateStaged,
  type ReadyUpdate,
} from "@/lib/ota-control";

export type { ReadyUpdate } from "@/lib/ota-control";

/** How often a foregrounded app asks the OTA server for a newer bundle. */
export const CHECK_INTERVAL_MS = 30_000;

/** How long a forced update or rollback waits before reloading. */
export const FORCED_RELOAD_DELAY_MS = 250;

/**
 * Checks for a new OTA bundle on mount, whenever the app comes back to the
 * foreground, and every `intervalMs` while it is in the foreground. A bundle
 * is downloaded in the background and returned as `ready` once it is staged;
 * the caller decides when to `reload` into it. A force update (`deploy -f`, or
 * a rollback of the running bundle) reloads at once.
 *
 * A failed check or download is silent: the next tick tries again. While
 * mounted, the loop can also be driven from outside (`src/lib/ota-control.ts`):
 * a check on demand, or a previewed banner that `dismiss` hides again.
 */
export function useOtaUpdate(intervalMs = CHECK_INTERVAL_MS) {
  const [ready, setReady] = useState<ReadyUpdate | null>(null);
  const stagedId = useRef<string | null>(null);
  const checking = useRef(false);

  useEffect(() => {
    let active = true;

    async function check(): Promise<CheckOutcome> {
      if (AppState.currentState === "background") return { status: "unavailable" };
      if (checking.current) return { status: "busy" };
      checking.current = true;
      try {
        const update = await HotUpdater.checkForUpdate({ updateStrategy: UPDATE_STRATEGY });
        if (!update) return { status: "no_update" };
        // The server keeps offering a staged bundle until the app reloads into it.
        if (update.id === stagedId.current) return { status: "already_staged", id: update.id };
        if (!(await update.updateBundle())) return { status: "download_failed", id: update.id };
        stagedId.current = update.id;
        if (update.shouldForceUpdate) {
          // Reload a moment later, so a caller of checkForUpdateNow (the
          // ota_check_now agent tool) gets its answer before the JS restarts.
          setTimeout(() => void HotUpdater.reload(), FORCED_RELOAD_DELAY_MS);
          return { status: "reloading", id: update.id };
        }
        const staged: ReadyUpdate = {
          id: update.id,
          message: update.message ?? null,
          rollback: update.status === "ROLLBACK",
        };
        if (active) setReady(staged);
        notifyUpdateStaged(staged);
        return { status: "staged", update: staged };
      } catch (error) {
        // Offline, server down, download failed: try again on the next tick.
        return { status: "failed", error: error instanceof Error ? error.message : String(error) };
      } finally {
        checking.current = false;
      }
    }

    const detach = attachOtaControl({
      check,
      preview: (update) => {
        if (active) setReady(update);
      },
    });
    void check();
    const timer = setInterval(() => void check(), intervalMs);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void check();
    });
    return () => {
      active = false;
      detach();
      clearInterval(timer);
      subscription.remove();
    };
  }, [intervalMs]);

  const reload = useCallback(() => HotUpdater.reload(), []);
  const dismiss = useCallback(() => setReady(null), []);
  return { ready, reload, dismiss };
}
