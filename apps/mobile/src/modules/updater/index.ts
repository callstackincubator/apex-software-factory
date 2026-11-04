import { createExpoUpdater } from "./expo-updates";
import type { Updater } from "./port";

let current: Updater | null = null;

export function getUpdater(): Updater {
  current ??= createExpoUpdater();
  return current;
}

export function setUpdater(next: Updater): void {
  current = next;
}

export {
  createFakeUpdater,
  FAKE_EMBEDDED_BUNDLE_ID,
  type FakeUpdate,
  type FakeUpdater,
} from "./fake";
export type { AvailableUpdate, RunningBundle, Updater } from "./port";
