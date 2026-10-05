import { events } from "@apex/event-bus";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { AppState, type AppStateStatus } from "react-native";

import {
  createFakeUpdater,
  type FakeUpdate,
  type FakeUpdater,
  setUpdater,
} from "@/modules/updater";

import { checkForUpdateNow, previewUpdateBanner, UpdateBanner } from "..";
import { CHECK_INTERVAL_MS, FORCED_RELOAD_DELAY_MS } from "../use-ota-update";

jest.mock(
  "react-native-safe-area-context",
  () => require("react-native-safe-area-context/jest/mock").default,
);

const CONFETTI: FakeUpdate = {
  id: "0199b111-2222-7333-8444-555566667777",
  message: "Add a confetti button",
};

async function flush() {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
}

const BANNER = /New feature landed/;

let updater: FakeUpdater;
let appStateListener: ((state: AppStateStatus) => void) | undefined;

beforeEach(() => {
  jest.useFakeTimers();
  updater = createFakeUpdater();
  setUpdater(updater);
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

    expect(updater.checks).toBe(1);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("downloads a new bundle, then offers it with the deploy message", async () => {
    updater.offer(CONFETTI);
    await render(<UpdateBanner />);
    await flush();

    expect(updater.downloads).toBe(1);
    expect(screen.getByText("New feature landed")).toBeOnTheScreen();
    expect(screen.getByText("Add a confetti button")).toBeOnTheScreen();
    expect(updater.reloads).toBe(0);
  });

  it("reloads into the new bundle when tapped", async () => {
    updater.offer(CONFETTI);
    await render(<UpdateBanner />);
    await flush();

    await fireEvent.press(screen.getByRole("button", { name: BANNER }));

    expect(updater.reloads).toBe(1);
    expect(screen.getByText("Reloading…")).toBeOnTheScreen();
  });

  it("offers nothing when the download fails", async () => {
    updater.offer({ ...CONFETTI, downloads: false });
    await render(<UpdateBanner />);
    await flush();

    expect(screen.queryByRole("button")).toBeNull();
  });

  it("reloads at once, without a banner, when the server forces the update", async () => {
    updater.offer({ ...CONFETTI, forced: true });
    await render(<UpdateBanner />);
    await flush();
    await act(async () => {
      jest.advanceTimersByTime(FORCED_RELOAD_DELAY_MS);
    });

    expect(updater.reloads).toBe(1);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("checks again every 30 seconds", async () => {
    await render(<UpdateBanner />);
    await flush();
    expect(screen.queryByRole("button")).toBeNull();

    updater.offer(CONFETTI);
    await act(async () => {
      jest.advanceTimersByTime(CHECK_INTERVAL_MS);
    });
    await flush();

    expect(CHECK_INTERVAL_MS).toBe(30_000);
    expect(updater.checks).toBe(2);
    expect(screen.getByRole("button", { name: BANNER })).toBeOnTheScreen();
  });

  it("checks again when the app comes back to the foreground", async () => {
    await render(<UpdateBanner />);
    await flush();

    updater.offer(CONFETTI);
    await act(async () => appStateListener?.("active"));
    await flush();

    expect(updater.checks).toBe(2);
    expect(screen.getByRole("button", { name: BANNER })).toBeOnTheScreen();
  });

  it("does not download a bundle it has already staged", async () => {
    updater.offer(CONFETTI);
    await render(<UpdateBanner />);
    await flush();

    await act(async () => {
      jest.advanceTimersByTime(CHECK_INTERVAL_MS);
    });
    await flush();

    expect(updater.checks).toBe(2);
    expect(updater.downloads).toBe(1);
  });

  it("replaces the offer when a newer bundle lands before the reload", async () => {
    updater.offer(CONFETTI);
    await render(<UpdateBanner />);
    await flush();

    updater.offer({
      id: "0199b999-0000-7000-8000-000000000001",
      message: "Add a dark mode toggle",
    });
    await act(async () => {
      jest.advanceTimersByTime(CHECK_INTERVAL_MS);
    });
    await flush();

    expect(screen.getByText("Add a dark mode toggle")).toBeOnTheScreen();
    expect(screen.queryByText("Add a confetti button")).toBeNull();
  });

  it("stays quiet when the check fails, and recovers on the next tick", async () => {
    updater.offer(new TypeError("Network request failed"));
    await render(<UpdateBanner />);
    await flush();
    expect(screen.queryByRole("button")).toBeNull();

    updater.offer(CONFETTI);
    await act(async () => {
      jest.advanceTimersByTime(CHECK_INTERVAL_MS);
    });
    await flush();

    expect(screen.getByRole("button", { name: BANNER })).toBeOnTheScreen();
  });

  it("names a rollback as a withdrawn update", async () => {
    updater.offer({ ...CONFETTI, rollback: true, message: null });
    await render(<UpdateBanner />);
    await flush();

    expect(screen.getByRole("button", { name: /Update withdrawn/ })).toBeOnTheScreen();
  });

  it("runs a check on demand and reports the bundle it staged", async () => {
    await render(<UpdateBanner />);
    await flush();
    updater.offer(CONFETTI);

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
    expect(updater.checks).toBe(0);
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

    expect(updater.reloads).toBe(0);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("answers an on-demand check before it reloads into a forced update", async () => {
    await render(<UpdateBanner />);
    await flush();
    updater.offer({ ...CONFETTI, rollback: true, forced: true });

    let outcome: Awaited<ReturnType<typeof checkForUpdateNow>> | undefined;
    await act(async () => {
      outcome = await checkForUpdateNow();
    });

    expect(outcome).toEqual({ status: "reloading", id: "0199b111-2222-7333-8444-555566667777" });
    expect(updater.reloads).toBe(0);
    await act(async () => {
      jest.advanceTimersByTime(FORCED_RELOAD_DELAY_MS);
    });
    expect(updater.reloads).toBe(1);
  });

  it("announces a staged bundle on the event bus, and not a previewed one", async () => {
    const staged = jest.fn();
    const off = events.on("ota/update-staged", staged);
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
    updater.offer(CONFETTI);
    await act(async () => {
      await checkForUpdateNow();
    });
    off();

    expect(staged.mock.calls).toEqual([
      [{ id: CONFETTI.id, message: "Add a confetti button", rollback: false }],
    ]);
  });
});
