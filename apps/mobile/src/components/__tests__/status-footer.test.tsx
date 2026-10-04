import { createApiClient } from "@apex/contract";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { Platform } from "react-native";

import { StatusFooter } from "@/components/status-footer";

// jest-expo's expo-constants mock carries no app config. "1.0.0" is the exact
// version e2e/app-platform.ad pins on the device; the tie test below keeps the
// two in step so a version bump fails here, not on a simulator run.
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { expoConfig: { version: "1.0.0" } },
}));

const appJsonVersion: string = require("../../../app.json").expo.version;

function clientReturning(response: () => Promise<Response>) {
  return createApiClient({ baseUrl: "http://api.test", fetch: response });
}

describe("StatusFooter", () => {
  // The footer names the platform it runs on, read from Platform.OS at render.
  const platform = Platform as { OS: string };
  const realOS = platform.OS;
  afterEach(() => {
    platform.OS = realOS;
  });

  it("reports the API as offline when the request fails", async () => {
    const client = clientReturning(() => Promise.reject(new TypeError("Network request failed")));
    await render(<StatusFooter client={client} />);

    expect(await screen.findByText("offline")).toBeOnTheScreen();
  });

  it("reports the API as offline when the response breaks the contract", async () => {
    const client = clientReturning(async () => Response.json({ status: "degraded" }));
    await render(<StatusFooter client={client} />);

    expect(await screen.findByText("offline")).toBeOnTheScreen();
  });

  it("shows the API version once healthy, and re-checks on press", async () => {
    let calls = 0;
    const client = clientReturning(async () => {
      calls += 1;
      return Response.json({ status: "ok", version: "1.4.0", uptimeSeconds: 12 });
    });
    await render(<StatusFooter client={client} />);

    expect(await screen.findByText("ok · v1.4.0")).toBeOnTheScreen();
    expect(calls).toBe(1);

    await fireEvent.press(screen.getByRole("button", { name: "API status: ok · v1.4.0" }));
    expect(await screen.findByText("ok · v1.4.0")).toBeOnTheScreen();
    expect(calls).toBe(2);
  });

  it("shows the app version and the running bundle", async () => {
    platform.OS = "ios";
    const client = clientReturning(() => Promise.reject(new Error("down")));
    await render(<StatusFooter client={client} />);

    expect(screen.getByText("v1.0.0 · iOS")).toBeOnTheScreen();
    expect(screen.getByText("embedded · production")).toBeOnTheScreen();
    await screen.findByText("offline");
  });

  it('the footer shows the app version and "iOS" on iOS, with the label "App version 1.0.0 on iOS"', async () => {
    platform.OS = "ios";
    const client = clientReturning(() => Promise.reject(new Error("down")));
    await render(<StatusFooter client={client} />);

    expect(screen.getByText("v1.0.0 · iOS")).toBeOnTheScreen();
    expect(screen.getByTestId("status-app")).toHaveAccessibleName("App version 1.0.0 on iOS");
  });

  it('the footer shows the app version and "Android" on Android', async () => {
    platform.OS = "android";
    const client = clientReturning(() => Promise.reject(new Error("down")));
    await render(<StatusFooter client={client} />);

    expect(screen.getByText("v1.0.0 · Android")).toBeOnTheScreen();
    expect(screen.getByTestId("status-app")).toHaveAccessibleName("App version 1.0.0 on Android");
  });

  it("shows any other platform value as it is", async () => {
    platform.OS = "web";
    const client = clientReturning(() => Promise.reject(new Error("down")));
    await render(<StatusFooter client={client} />);

    expect(screen.getByText("v1.0.0 · web")).toBeOnTheScreen();
    expect(screen.getByTestId("status-app")).toHaveAccessibleName("App version 1.0.0 on web");
  });

  it("pins the same app version the e2e script checks on the device", () => {
    // e2e/app-platform.ad asserts the label "App version 1.0.0 on iOS" against
    // the real app.json version. If they drift, fail here, not on the device lane.
    expect(appJsonVersion).toBe("1.0.0");
  });
});
