import * as Updates from "expo-updates";

import { createExpoUpdater, ROLLBACK_TO_EMBEDDED_ID } from "../expo-updates";

const NEW_UPDATE_ID = "0199b111-2222-7333-8444-555566667777";

function serverOffers(result: object) {
  jest.mocked(Updates.checkForUpdateAsync).mockResolvedValueOnce(result as never);
}

function fetchReturns(result: object) {
  jest.mocked(Updates.fetchUpdateAsync).mockResolvedValueOnce(result as never);
}

describe("expo-updates adapter", () => {
  it("offers nothing when the server has nothing newer", async () => {
    await expect(createExpoUpdater().check()).resolves.toBeNull();
  });

  it("offers a new update under its manifest id, and downloads it on demand", async () => {
    serverOffers({
      isAvailable: true,
      isRollBackToEmbedded: false,
      manifest: { id: NEW_UPDATE_ID },
    });
    fetchReturns({ isNew: true, isRollBackToEmbedded: false });

    const update = await createExpoUpdater().check();

    expect(update).toMatchObject({ id: NEW_UPDATE_ID, rollback: false, forced: false });
    expect(Updates.fetchUpdateAsync).not.toHaveBeenCalled();
    await expect(update?.download()).resolves.toBe(true);
  });

  it("reads a roll back to the embedded bundle as a rollback", async () => {
    serverOffers({ isAvailable: false, isRollBackToEmbedded: true });
    fetchReturns({ isNew: false, isRollBackToEmbedded: true });

    const update = await createExpoUpdater().check();

    expect(update).toMatchObject({ id: ROLLBACK_TO_EMBEDDED_ID, rollback: true });
    await expect(update?.download()).resolves.toBe(true);
  });

  it("reports a download that fetched nothing new as failed", async () => {
    serverOffers({
      isAvailable: true,
      isRollBackToEmbedded: false,
      manifest: { id: NEW_UPDATE_ID },
    });
    fetchReturns({ isNew: false, isRollBackToEmbedded: false });

    const update = await createExpoUpdater().check();

    await expect(update?.download()).resolves.toBe(false);
  });

  it("describes the running bundle and the runtime version as the fingerprint", () => {
    const updater = createExpoUpdater();

    expect(updater.runningBundle()).toEqual({
      id: Updates.updateId,
      embedded: true,
      channel: "production",
    });
    expect(updater.fingerprint()).toBe(Updates.runtimeVersion);
  });

  describe("update channel", () => {
    beforeEach(() => {
      jest.mocked(Updates.setUpdateRequestHeadersOverride).mockClear();
      jest.mocked(Updates.checkForUpdateAsync).mockClear();
    });

    it("asks the requested channel, before the first check, when the binary embeds another", async () => {
      const updater = createExpoUpdater({ channel: "lane" });
      await updater.check();

      expect(Updates.setUpdateRequestHeadersOverride).toHaveBeenCalledWith({
        "expo-channel-name": "lane",
      });
      const [overrideOrder] = jest.mocked(Updates.setUpdateRequestHeadersOverride).mock
        .invocationCallOrder;
      const [checkOrder] = jest.mocked(Updates.checkForUpdateAsync).mock.invocationCallOrder;
      expect(overrideOrder).toBeLessThan(checkOrder as number);
      expect(updater.runningBundle().channel).toBe("lane");
    });

    it.each([undefined, "", "production"])(
      "keeps the embedded channel when the request is %p",
      (channel) => {
        const updater = createExpoUpdater({ channel });

        expect(Updates.setUpdateRequestHeadersOverride).not.toHaveBeenCalled();
        expect(updater.runningBundle().channel).toBe("production");
      },
    );
  });
});
