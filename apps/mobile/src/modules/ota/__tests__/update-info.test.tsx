import { render, screen } from "@testing-library/react-native";

import { createFakeUpdater, type FakeUpdater, setUpdater } from "@/modules/updater";

import { UpdateInfo } from "..";

const OTA_ID = "0199b111-2222-7333-8444-555566667777";

let updater: FakeUpdater;

beforeEach(() => {
  updater = createFakeUpdater();
  setUpdater(updater);
});

describe("UpdateInfo", () => {
  it("shows the embedded bundle and the channel when no OTA bundle is running", async () => {
    await render(<UpdateInfo />);

    expect(screen.getByText("embedded · production")).toBeOnTheScreen();
    expect(screen.getByLabelText("Embedded bundle, channel production")).toBeOnTheScreen();
  });

  it("shows the OTA bundle id, shortened, and the channel after an update", async () => {
    updater.runBundle({ id: OTA_ID, embedded: false, channel: "staging" });
    await render(<UpdateInfo />);

    expect(screen.getByText("ota 0199b111…7777 · staging")).toBeOnTheScreen();
    expect(
      screen.getByLabelText(`Over-the-air bundle ${OTA_ID}, channel staging`),
    ).toBeOnTheScreen();
  });
});
