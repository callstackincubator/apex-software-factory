// Jest picks this up automatically for every test (a node module mock next to
// node_modules): the real package needs its native module. By default the app
// runs the binary's embedded bundle and the server has no update; tests
// override individual functions with jest.mocked(HotUpdater.x).
export const BUILD_BUNDLE_ID = "0199a000-0000-7000-8000-000000000000";

export const HotUpdater = {
  init: jest.fn(),
  checkForUpdate: jest.fn(async () => null),
  reload: jest.fn(async () => {}),
  getBundleId: jest.fn(() => BUILD_BUNDLE_ID),
  getMinBundleId: jest.fn(() => BUILD_BUNDLE_ID),
  getChannel: jest.fn(() => "production"),
};
