export type ReadyUpdate = {
  id: string;
  message: string | null;
  rollback: boolean;
  preview?: boolean;
};

export type CheckOutcome =
  | { status: "no_update" }
  | { status: "staged"; update: ReadyUpdate }
  | { status: "already_staged"; id: string }
  | { status: "reloading"; id: string }
  | { status: "download_failed"; id: string }
  | { status: "failed"; error: string }
  | { status: "busy" }
  | { status: "unavailable" };

type Controller = {
  check(): Promise<CheckOutcome>;
  preview(update: ReadyUpdate | null): void;
};

// The check loop lives in a hook, but agent tools outside React drive it too.
let controller: Controller | null = null;

export function attachOtaControl(next: Controller): () => void {
  controller = next;
  return () => {
    if (controller === next) controller = null;
  };
}

export async function checkForUpdateNow(): Promise<CheckOutcome> {
  return controller ? controller.check() : { status: "unavailable" };
}

export function previewUpdateBanner(update: ReadyUpdate | null): boolean {
  if (!controller) return false;
  controller.preview(update);
  return true;
}
