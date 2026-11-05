// The real package needs its native module. Only the updater module's adapter test reaches it.
export const EMBEDDED_UPDATE_ID = "0199a000-0000-7000-8000-000000000000";

export const isEnabled = true;
export const isEmbeddedLaunch = true;
export const updateId: string | null = EMBEDDED_UPDATE_ID;
export const channel: string | null = "production";
export const runtimeVersion: string | null = "fingerprint-hash";

export const checkForUpdateAsync = jest.fn(async () => ({
  isAvailable: false,
  isRollBackToEmbedded: false,
}));
export const fetchUpdateAsync = jest.fn(async () => ({
  isNew: false,
  isRollBackToEmbedded: false,
}));
export const reloadAsync = jest.fn(async () => {});
export const setUpdateRequestHeadersOverride = jest.fn();
