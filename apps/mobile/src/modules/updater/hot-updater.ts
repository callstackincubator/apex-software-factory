import { HotUpdater } from "@hot-updater/react-native";

import type { Updater } from "./port";

const serverUrl = process.env.EXPO_PUBLIC_OTA_URL ?? "http://localhost:3002/hot-updater";

let started = false;

export function createHotUpdater(): Updater {
  return {
    serverUrl,
    start() {
      if (started) return;
      started = true;
      // init, not HotUpdater.wrap: the ota module owns when to check and when to reload.
      HotUpdater.init({ baseURL: serverUrl });
    },
    async check() {
      const update = await HotUpdater.checkForUpdate({ updateStrategy: "fingerprint" });
      if (!update) return null;
      return {
        id: update.id,
        message: update.message ?? null,
        rollback: update.status === "ROLLBACK",
        forced: update.shouldForceUpdate,
        download: () => update.updateBundle(),
      };
    },
    reload: () => HotUpdater.reload(),
    runningBundle() {
      const id = HotUpdater.getBundleId();
      // Without an OTA bundle the native side reports the binary's build-time id.
      return { id, embedded: id === HotUpdater.getMinBundleId(), channel: HotUpdater.getChannel() };
    },
    fingerprint: () => HotUpdater.getFingerprintHash(),
  };
}
