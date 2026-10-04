/**
 * A remote control for the OTA check loop in `useOtaUpdate`, so code outside
 * React — the agent tools in `src/dev/agent-tools.ts` — can run a check right
 * now instead of waiting for the next 30 s tick, preview the update banner,
 * and hear when a bundle is staged. The hook attaches itself while it is
 * mounted; with nothing attached every call reports `unavailable`.
 */

/** A bundle that is downloaded and staged, waiting for a reload to run. */
export type ReadyUpdate = {
  id: string;
  /** The deploy message (`ota:deploy -m`), i.e. the merge commit subject. */
  message: string | null;
  /** The server is taking a bad bundle back rather than shipping a new one. */
  rollback: boolean;
  /** Shown on request (agent tool), not downloaded: tapping it only dismisses it. */
  preview?: boolean;
};

/** What one update check did. */
export type CheckOutcome =
  /** The server has nothing newer for this binary. */
  | { status: "no_update" }
  /** A new bundle was downloaded and staged; the banner is showing it. */
  | { status: "staged"; update: ReadyUpdate }
  /** The server offered the bundle that is already staged. */
  | { status: "already_staged"; id: string }
  /** The server forced the update (or a rollback): the app is reloading now. */
  | { status: "reloading"; id: string }
  /** The download did not finish; the next check tries again. */
  | { status: "download_failed"; id: string }
  /** The check itself failed (offline, server down, debug build). */
  | { status: "failed"; error: string }
  /** Another check is running; its result will show in the banner. */
  | { status: "busy" }
  /** No check loop is mounted (or the app is in the background). */
  | { status: "unavailable" };

type Controller = {
  check(): Promise<CheckOutcome>;
  preview(update: ReadyUpdate | null): void;
};

let controller: Controller | null = null;
const stagedListeners = new Set<(update: ReadyUpdate) => void>();

/** Called by `useOtaUpdate` while mounted; returns the detach function. */
export function attachOtaControl(next: Controller): () => void {
  controller = next;
  return () => {
    if (controller === next) controller = null;
  };
}

/** Runs one update check immediately and reports what it did. */
export async function checkForUpdateNow(): Promise<CheckOutcome> {
  return controller ? controller.check() : { status: "unavailable" };
}

/**
 * Shows the update banner as if a bundle had landed (`update`), or hides it
 * (`null`). Returns false when no banner is mounted.
 */
export function previewUpdateBanner(update: ReadyUpdate | null): boolean {
  if (!controller) return false;
  controller.preview(update);
  return true;
}

/** Subscribes to real (not previewed) bundles being staged. */
export function onUpdateStaged(listener: (update: ReadyUpdate) => void): () => void {
  stagedListeners.add(listener);
  return () => {
    stagedListeners.delete(listener);
  };
}

/** Called by `useOtaUpdate` after a download finishes. */
export function notifyUpdateStaged(update: ReadyUpdate): void {
  for (const listener of stagedListeners) listener(update);
}
