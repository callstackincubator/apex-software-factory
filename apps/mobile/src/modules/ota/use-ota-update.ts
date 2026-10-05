import { events } from "@apex/event-bus";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import { getUpdater } from "@/modules/updater";

import { attachOtaControl, type CheckOutcome, type ReadyUpdate } from "./control";

export const CHECK_INTERVAL_MS = 30_000;

export const FORCED_RELOAD_DELAY_MS = 250;

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
        const update = await getUpdater().check();
        if (!update) return { status: "no_update" };
        // The server keeps offering a staged bundle until the app reloads into it.
        if (update.id === stagedId.current) return { status: "already_staged", id: update.id };
        if (!(await update.download())) return { status: "download_failed", id: update.id };
        stagedId.current = update.id;
        if (update.forced) {
          // Later, so an on-demand caller gets its answer before the JS restarts.
          setTimeout(() => void getUpdater().reload(), FORCED_RELOAD_DELAY_MS);
          return { status: "reloading", id: update.id };
        }
        const staged: ReadyUpdate = {
          id: update.id,
          message: update.message,
          rollback: update.rollback,
        };
        if (active) setReady(staged);
        events.emit("ota/update-staged", staged);
        return { status: "staged", update: staged };
      } catch (error) {
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

  const reload = useCallback(() => getUpdater().reload(), []);
  const dismiss = useCallback(() => setReady(null), []);
  return { ready, reload, dismiss };
}
