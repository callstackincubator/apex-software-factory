import { getUpdater } from "@/modules/updater";

declare module "@apex/event-bus" {
  interface DomainEvents {
    "ota/update-staged": { id: string; message: string | null; rollback: boolean };
  }
}

export function initOta(): void {
  getUpdater().start();
}

export {
  type CheckOutcome,
  checkForUpdateNow,
  previewUpdateBanner,
  type ReadyUpdate,
} from "./control";
export { UpdateBanner } from "./update-banner";
export { UpdateInfo } from "./update-info";
