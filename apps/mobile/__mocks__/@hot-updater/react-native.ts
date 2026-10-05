// The real package needs its native module. Only the updater module's adapter test reaches it.
export const BUILD_BUNDLE_ID = "0199a000-0000-7000-8000-000000000000";

export const HotUpdater = {
  init: jest.fn(),
  checkForUpdate: jest.fn(async () => null),
  reload: jest.fn(async () => {}),
  getBundleId: jest.fn(() => BUILD_BUNDLE_ID),
  getMinBundleId: jest.fn(() => BUILD_BUNDLE_ID),
  getChannel: jest.fn(() => "production"),
  getFingerprintHash: jest.fn(() => null),
};
