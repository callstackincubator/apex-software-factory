import { HotUpdater } from "@hot-updater/react-native";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { AppState, type AppStateStatus } from "react-native";

import { UpdateBanner } from "@/components/update-banner";
import { checkForUpdateNow, previewUpdateBanner } from "@/lib/ota-control";
import { CHECK_INTERVAL_MS } from "@/lib/use-ota-update";

jest.mock(
  "react-native-safe-area-context",
  () => require("react-native-safe-area-context/jest/mock").default,
);

type CheckResult = Awaited<ReturnType<typeof HotUpdater.checkForUpdate>>;

const checkForUpdate = jest.mocked(HotUpdater.checkForUpdate);
const reload = jest.mocked(HotUpdater.reload);

function update(
  overrides: Partial<NonNullable<CheckResult>> = {},
): NonNullable<CheckResult> & { updateBundle: jest.Mock } {
  return {
    id: "0199b111-2222-7333-8444-555566667777",
    status: "UPDATE",
    shouldForceUpdate: false,
    message: "Add a confetti button",
    fileUrl: "http://localhost:9000/hot-updater/bundle.zip",
    fileHash: "0".repeat(64),
    updateBundle: jest.fn(async () => true),
    ...overrides,
  } as NonNullable<CheckResult> & { updateBundle: jest.Mock };
}

/** Lets pending promise callbacks (check → download → state) run. */
async function flush() {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
}

const BANNER = /New feature landed/;

let appStateListener: ((state: AppStateStatus) => void) | undefined;

beforeEach(() => {
  jest.useFakeTimers();
  checkForUpdate.mockReset().mockResolvedValue(null);
  reload.mockReset().mockResolvedValue(undefined);
  appStateListener = undefined;
  jest.spyOn(AppState, "addEventListener").mockImplementation((_type, listener) => {
    appStateListener = listener;
    return { remove: jest.fn() };
  });
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("UpdateBanner", () => {
  it("shows nothing while the server has no update", async () => {
    await render(<UpdateBanner />);
    await flush();

    expect(checkForUpdate).toHaveBeenCalledWith({ updateStrategy: "fingerprint" });
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("downloads a new bundle, then offers it with the deploy message", async () => {
    const available = update();
    checkForUpdate.mockResolvedValue(available);
    await render(<UpdateBanner />);
    await flush();

    expect(available.updateBundle).toHaveBeenCalledTimes(1);
    expect(screen.getByText("New feature landed")).toBeOnTheScreen();
    expect(screen.getByText("Add a confetti button")).toBeOnTheScreen();
    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads into the new bundle when tapped", async () => {
    checkForUpdate.mockResolvedValue(update());
    await render(<UpdateBanner />);
    await flush();

    await fireEvent.press(screen.getByRole("button", { name: BANNER }));

    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Reloading…")).toBeOnTheScreen();
  });

  it("offers nothing when the download fails", async () => {
    checkForUpdate.mockResolvedValue(update({ updateBundle: jest.fn(async () => false) }));
    await render(<UpdateBanner />);
    await flush();

    expect(screen.queryByRole("button")).toBeNull();
  });

  it("reloads at once, without a banner, when the server forces the update", async () => {
    checkForUpdate.mockResolvedValue(update({ shouldForceUpdate: true }));
    await render(<UpdateBanner />);
    await flush();

    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("checks again every 30 seconds", async () => {
    await render(<UpdateBanner />);
    await flush();
    expect(screen.queryByRole("button")).toBeNull();

    checkForUpdate.mockResolvedValue(update());
    await act(async () => {
      jest.advanceTimersByTime(CHECK_INTERVAL_MS);
    });
    await flush();

    expect(CHECK_INTERVAL_MS).toBe(30_000);
    expect(checkForUpdate).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: BANNER })).toBeOnTheScreen();
  });

  it("checks again when the app comes back to the foreground", async () => {
    await render(<UpdateBanner />);
    await flush();

    checkForUpdate.mockResolvedValue(update());
    await act(async () => appStateListener?.("active"));
    await flush();

    expect(checkForUpdate).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: BANNER })).toBeOnTheScreen();
  });

  it("does not download a bundle it has already staged", async () => {
    const available = update();
    checkForUpdate.mockResolvedValue(available);
    await render(<UpdateBanner />);
    await flush();

    await act(async () => {
      jest.advanceTimersByTime(CHECK_INTERVAL_MS);
    });
    await flush();

    expect(checkForUpdate).toHaveBeenCalledTimes(2);
    expect(available.updateBundle).toHaveBeenCalledTimes(1);
  });

  it("replaces the offer when a newer bundle lands before the reload", async () => {
    checkForUpdate.mockResolvedValue(update());
    await render(<UpdateBanner />);
    await flush();

    checkForUpdate.mockResolvedValue(
      update({ id: "0199b999-0000-7000-8000-000000000001", message: "Add a dark mode toggle" }),
    );
    await act(async () => {
      jest.advanceTimersByTime(CHECK_INTERVAL_MS);
    });
    await flush();

    expect(screen.getByText("Add a dark mode toggle")).toBeOnTheScreen();
    expect(screen.queryByText("Add a confetti button")).toBeNull();
  });

  it("stays quiet when the check fails, and recovers on the next tick", async () => {
    checkForUpdate.mockRejectedValue(new TypeError("Network request failed"));
    await render(<UpdateBanner />);
    await flush();
    expect(screen.queryByRole("button")).toBeNull();

    checkForUpdate.mockResolvedValue(update());
    await act(async () => {
      jest.advanceTimersByTime(CHECK_INTERVAL_MS);
    });
    await flush();

    expect(screen.getByRole("button", { name: BANNER })).toBeOnTheScreen();
  });

  it("names a rollback as a withdrawn update", async () => {
    checkForUpdate.mockResolvedValue(update({ status: "ROLLBACK", message: null }));
    await render(<UpdateBanner />);
    await flush();

    expect(screen.getByRole("button", { name: /Update withdrawn/ })).toBeOnTheScreen();
  });

  it("runs a check on demand and reports the bundle it staged", async () => {
    await render(<UpdateBanner />);
    await flush();
    checkForUpdate.mockResolvedValue(update());

    let outcome: Awaited<ReturnType<typeof checkForUpdateNow>> | undefined;
    await act(async () => {
      outcome = await checkForUpdateNow();
    });

    expect(outcome).toEqual({
      status: "staged",
      update: {
        id: "0199b111-2222-7333-8444-555566667777",
        message: "Add a confetti button",
        rollback: false,
      },
    });
    expect(screen.getByRole("button", { name: BANNER })).toBeOnTheScreen();
  });

  it("reports an on-demand check as unavailable when no banner is mounted", async () => {
    await expect(checkForUpdateNow()).resolves.toEqual({ status: "unavailable" });
    expect(checkForUpdate).not.toHaveBeenCalled();
  });

  it("shows a previewed banner like a landed feature, and a tap only dismisses it", async () => {
    await render(<UpdateBanner />);
    await flush();

    await act(async () => {
      previewUpdateBanner({
        id: "preview-update",
        message: "Preview",
        rollback: false,
        preview: true,
      });
    });
    expect(screen.getByText("New feature landed")).toBeOnTheScreen();
    expect(screen.getByText("Preview")).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole("button", { name: BANNER }));

    expect(reload).not.toHaveBeenCalled();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
