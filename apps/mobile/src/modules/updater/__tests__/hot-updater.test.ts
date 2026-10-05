import { HotUpdater } from "@hot-updater/react-native";

import { createHotUpdater } from "../hot-updater";

type CheckResult = NonNullable<Awaited<ReturnType<typeof HotUpdater.checkForUpdate>>>;

function serverOffers(overrides: Partial<CheckResult>) {
  jest.mocked(HotUpdater.checkForUpdate).mockResolvedValue({
    id: "0199b111-2222-7333-8444-555566667777",
    status: "UPDATE",
    shouldForceUpdate: false,
    message: "Add a confetti button",
    fileUrl: "http://localhost:9000/hot-updater/bundle.zip",
    fileHash: "0".repeat(64),
    updateBundle: jest.fn(async () => true),
    ...overrides,
  } as CheckResult);
}

describe("hot-updater adapter", () => {
  it("asks for bundles matching this binary's fingerprint", async () => {
    await createHotUpdater().check();

    expect(HotUpdater.checkForUpdate).toHaveBeenCalledWith({ updateStrategy: "fingerprint" });
  });

  it("reads a forced ROLLBACK without a message as a forced rollback", async () => {
    serverOffers({ status: "ROLLBACK", shouldForceUpdate: true, message: undefined });

    await expect(createHotUpdater().check()).resolves.toMatchObject({
      rollback: true,
      forced: true,
      message: null,
    });
  });

  it("reports the binary's own bundle as embedded, and an OTA bundle as not", () => {
    const updater = createHotUpdater();
    jest.mocked(HotUpdater.getBundleId).mockReturnValueOnce(HotUpdater.getMinBundleId());
    expect(updater.runningBundle().embedded).toBe(true);

    jest.mocked(HotUpdater.getBundleId).mockReturnValueOnce("0199b111-2222-7333-8444-555566667777");
    expect(updater.runningBundle().embedded).toBe(false);
  });
});
