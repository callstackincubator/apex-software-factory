import { HotUpdater } from "@hot-updater/react-native";
import { render, screen } from "@testing-library/react-native";

import { UpdateInfo } from "@/components/update-info";

const BUILD_ID = "0199a000-0000-7000-8000-000000000000";
const OTA_ID = "0199b111-2222-7333-8444-555566667777";

beforeEach(() => {
  jest.mocked(HotUpdater.getMinBundleId).mockReturnValue(BUILD_ID);
  jest.mocked(HotUpdater.getChannel).mockReturnValue("production");
});

describe("UpdateInfo", () => {
  it("shows the embedded bundle and the channel when no OTA bundle is running", async () => {
    jest.mocked(HotUpdater.getBundleId).mockReturnValue(BUILD_ID);
    await render(<UpdateInfo />);

    expect(screen.getByText("embedded · production")).toBeOnTheScreen();
    expect(screen.getByLabelText("Embedded bundle, channel production")).toBeOnTheScreen();
  });

  it("shows the OTA bundle id, shortened, and the channel after an update", async () => {
    jest.mocked(HotUpdater.getBundleId).mockReturnValue(OTA_ID);
    jest.mocked(HotUpdater.getChannel).mockReturnValue("staging");
    await render(<UpdateInfo />);

    expect(screen.getByText("ota 0199b111…7777 · staging")).toBeOnTheScreen();
    expect(
      screen.getByLabelText(`Over-the-air bundle ${OTA_ID}, channel staging`),
    ).toBeOnTheScreen();
  });
});
