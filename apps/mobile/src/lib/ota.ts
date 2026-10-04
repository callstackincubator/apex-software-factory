import { HotUpdater } from "@hot-updater/react-native";

/**
 * The OTA server (`apps/ota-server`). Set `EXPO_PUBLIC_OTA_URL` to the booth
 * laptop's LAN address when building a binary for a phone; it is inlined at
 * build time, so changing it needs a new binary.
 */
export const otaBaseUrl = process.env.EXPO_PUBLIC_OTA_URL ?? "http://localhost:3002/hot-updater";

/** Bundles are matched to binaries by native fingerprint (ADR 0003). */
export const UPDATE_STRATEGY = "fingerprint";

let initialized = false;

/**
 * Configures hot-updater once per JS runtime. Also reports this launch as
 * healthy to the native side, which is what lets it roll back a bundle that
 * crashes on start. Update checks are ours (`useOtaUpdate`), not the library's
 * automatic `wrap` flow, so there is exactly one place that decides when to
 * check and when to reload.
 */
export function initOta(): void {
  if (initialized) return;
  initialized = true;
  HotUpdater.init({ baseURL: otaBaseUrl });
}
