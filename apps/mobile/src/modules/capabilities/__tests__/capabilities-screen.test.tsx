import { act, fireEvent, render, screen } from "@testing-library/react-native";
import * as Speech from "expo-speech";

import { AppKeyboardProvider } from "@/modules/ui";

import { CapabilitiesScreen } from "../capabilities-screen";
import type { NativeCapabilityReport } from "../native-capabilities";
import { ANSWER_TIMEOUT_MS, SmokeBoundary } from "../smoke-card";
import { PermissionsSmoke } from "../smokes/permissions";

jest.mock(
  "react-native-safe-area-context",
  () => require("react-native-safe-area-context/jest/mock").default,
);

// Expo modules the smokes call, answering like a fresh simulator. (Skia,
// VisionCamera, maps, WebView, keyboard-controller and Nitro have node module
// mocks in apps/mobile/__mocks__; MMKV mocks itself under Jest.)
jest.mock("expo-clipboard", () => {
  let text = "";
  return {
    setStringAsync: jest.fn(async (value: string) => {
      text = value;
      return true;
    }),
    getStringAsync: jest.fn(async () => text),
  };
});
jest.mock("expo-sqlite", () => ({
  openDatabaseSync: jest.fn(() => ({
    execSync: jest.fn(),
    getFirstSync: jest.fn(() => ({ total: 42, version: "3.50.4" })),
    closeSync: jest.fn(),
  })),
}));
jest.mock("expo-sensors", () => {
  const sensor = (available: boolean) => ({ isAvailableAsync: jest.fn(async () => available) });
  return {
    Accelerometer: sensor(true),
    Gyroscope: sensor(true),
    Magnetometer: sensor(false),
    Barometer: sensor(false),
    DeviceMotion: sensor(true),
    Pedometer: sensor(false),
  };
});
const mockUndetermined = {
  status: "undetermined",
  granted: false,
  canAskAgain: true,
  expires: "never",
};
jest.mock("expo-notifications", () => ({
  getPermissionsAsync: jest.fn(async () => mockUndetermined),
}));
jest.mock("expo-calendar", () => ({
  getCalendarPermissions: jest.fn(async () => mockUndetermined),
}));
jest.mock("expo-location", () => ({
  getForegroundPermissionsAsync: jest.fn(async () => mockUndetermined),
}));
jest.mock("expo-media-library", () => ({
  getPermissionsAsync: jest.fn(async () => mockUndetermined),
}));
jest.mock("expo-sharing", () => ({ isAvailableAsync: jest.fn(async () => true) }));
jest.mock("expo-speech", () => ({
  getAvailableVoicesAsync: jest.fn(async () => [{ identifier: "a" }, { identifier: "b" }]),
}));

const lib = (id: string, status: "linked" | "missing" | "not-on-platform") => ({
  id,
  package: id,
  version: "1.0.0",
  status,
  missingModules: status === "missing" ? [`turbo:${id}`] : [],
  enables: id,
});

const allLinked: NativeCapabilityReport = {
  platform: "ios",
  allLinked: true,
  missing: [],
  libraries: [
    lib("skia", "linked"),
    lib("mmkv", "linked"),
    lib("barcode-scanner", "not-on-platform"),
  ],
};

const smoke = (id: string) => screen.getByTestId(`smoke-${id}`);

describe("CapabilitiesScreen", () => {
  it("summarises the probe and runs a live smoke per library", async () => {
    await render(
      <AppKeyboardProvider>
        <CapabilitiesScreen probe={() => allLinked} />
      </AppKeyboardProvider>,
    );

    expect(screen.getByTestId("capabilities-summary")).toHaveAccessibleName(
      "2 of 2 native libraries linked on ios",
    );
    expect(screen.getByTestId("capability-barcode-scanner")).toHaveAccessibleName(
      "barcode-scanner: not-on-platform",
    );

    // Smokes that call a module settle on their own (the modules are Jest mocks).
    expect(await screen.findByLabelText(/^MMKV: ok\. set\/get\/remove round-trip/)).toBeTruthy();
    expect(await screen.findByLabelText(/^Skia: ok\. offscreen draw \+ readPixels/)).toBeTruthy();
    expect(
      await screen.findByLabelText("SQLite: ok. in-memory query = 42 · SQLite 3.50.4"),
    ).toBeTruthy();
    expect(
      await screen.findByLabelText("Clipboard: ok. setString/getString round-trip"),
    ).toBeTruthy();
    expect(
      await screen.findByLabelText(
        "Sensors: info. available: accelerometer yes, gyroscope yes, magnetometer no, barometer no, devicemotion yes, pedometer no",
      ),
    ).toBeTruthy();
    expect(
      await screen.findByLabelText(
        "Permissions and services: info. notifications undetermined · calendar undetermined · location undetermined · photos undetermined · share sheet yes · voices 2",
      ),
    ).toBeTruthy();
    expect(smoke("keyboard-controller")).toHaveAccessibleName(
      "Keyboard controller: ok. KeyboardProvider mounted at the root",
    );
    expect(smoke("vision-camera")).toHaveAccessibleName(
      "VisionCamera: info. permission not-determined · 0 camera(s) · QR via object output",
    );

    // Smokes that wait for their native view to report back.
    expect(smoke("svg")).toHaveAccessibleName("SVG: pending. rendering…");
    await fireEvent(screen.getByTestId("svg-view"), "layout", layoutEvent);
    await fireEvent(screen.getByTestId("gradient-view"), "layout", layoutEvent);
    await fireEvent(screen.getByTestId("blur-view"), "layout", layoutEvent);
    await fireEvent(screen.getByTestId("map-view"), "mapReady");
    await fireEvent(screen.getByTestId("webview-view"), "message", {
      nativeEvent: { data: "ready" },
    });

    expect(smoke("svg")).toHaveAccessibleName("SVG: ok. Svg view rendered");
    expect(smoke("gradient-blur")).toHaveAccessibleName(
      "Linear gradient + blur: ok. LinearGradient and BlurView rendered",
    );
    expect(smoke("maps")).toHaveAccessibleName("Maps: ok. Apple Maps ready");
    expect(smoke("webview")).toHaveAccessibleName(
      "WebView: ok. HTML loaded, its script posted back",
    );
  });

  it("puts the missing libraries in the summary and fails the keyboard smoke without the provider", async () => {
    await render(
      <CapabilitiesScreen
        probe={() => ({
          platform: "android",
          allLinked: false,
          missing: ["mmkv"],
          libraries: [lib("skia", "linked"), lib("mmkv", "missing")],
        })}
      />,
    );

    expect(screen.getByTestId("capabilities-summary")).toHaveAccessibleName(
      "1 of 2 native libraries linked on android. Missing: mmkv",
    );
    expect(screen.getByTestId("capability-mmkv")).toHaveAccessibleName("mmkv: missing");
    expect(smoke("keyboard-controller")).toHaveAccessibleName(
      "Keyboard controller: failed. no KeyboardProvider above this screen",
    );
    await screen.findByLabelText(/^MMKV: ok/); // let the async smokes settle
  });
});

describe("PermissionsSmoke", () => {
  it("names a module that never answers instead of staying pending", async () => {
    jest.useFakeTimers();
    jest.mocked(Speech.getAvailableVoicesAsync).mockReturnValueOnce(new Promise(() => {}));

    await render(<PermissionsSmoke />);
    await act(async () => {
      jest.advanceTimersByTime(ANSWER_TIMEOUT_MS);
    });

    expect(smoke("permissions")).toHaveAccessibleName(
      "Permissions and services: failed. notifications undetermined · calendar undetermined · location undetermined · photos undetermined · share sheet yes · voices failed: voices did not answer in 5 s",
    );
    jest.useRealTimers();
  });
});

describe("SmokeBoundary", () => {
  it("turns a library that throws while loading into one failed card", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});

    await render(
      <SmokeBoundary
        id="vision-camera"
        title="VisionCamera"
        load={() => {
          throw new Error("HybridObject CameraFactory has not been registered");
        }}
      />,
    );

    expect(smoke("vision-camera")).toHaveAccessibleName(
      "VisionCamera: failed. HybridObject CameraFactory has not been registered",
    );
  });
});

const layoutEvent = { nativeEvent: { layout: { x: 0, y: 0, width: 64, height: 64 } } };
