import { createFakeApiClient, setApiClient } from "@/modules/api";
import { createFakeUpdater, setUpdater } from "@/modules/updater";

// Reanimated 4 (see jest.resolver.js): animations run on Jest's timers, not the UI thread.
require("react-native-reanimated").setUpTests();

beforeEach(() => {
  setUpdater(createFakeUpdater());
  setApiClient(createFakeApiClient(() => Promise.reject(new TypeError("No API in unit tests"))));
});
