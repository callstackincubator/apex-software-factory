import Constants from "expo-constants";
import * as Updates from "expo-updates";

import type { Updater } from "./port";

export const ROLLBACK_TO_EMBEDDED_ID = "rollback-to-embedded";

export function createExpoUpdater(): Updater {
  return {
    serverUrl: Constants.expoConfig?.updates?.url ?? "",
    async check() {
      if (!Updates.isEnabled) return null;
      const result = await Updates.checkForUpdateAsync();
      if (!result.isAvailable && !result.isRollBackToEmbedded) return null;
      return {
        id: result.isAvailable ? result.manifest.id : ROLLBACK_TO_EMBEDDED_ID,
        message: null,
        rollback: result.isRollBackToEmbedded,
        forced: false,
        download: async () => {
          const fetched = await Updates.fetchUpdateAsync();
          return fetched.isNew || fetched.isRollBackToEmbedded;
        },
      };
    },
    reload: () => Updates.reloadAsync(),
    runningBundle: () => ({
      id: Updates.updateId ?? "",
      embedded: !Updates.isEnabled || Updates.isEmbeddedLaunch,
      channel: Updates.channel ?? "none",
    }),
    fingerprint: () => Updates.runtimeVersion,
  };
}
