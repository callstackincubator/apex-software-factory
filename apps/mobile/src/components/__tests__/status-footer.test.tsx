import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createApiClient } from "@apex/contract";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { Platform } from "react-native";

import { StatusFooter } from "@/components/status-footer";

// jest-expo's expo-constants mock carries no app config; the render tests
// below assert against this fixed version. The real app version lives in
// app.json, and the tie test at the bottom keeps app.json and the version
// pinned in e2e/app-platform.ad in step, so a bump fails here, not on a
// simulator run.
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { expoConfig: { version: "1.0.0" } },
}));

const appJsonVersion: string = require("../../../app.json").expo.version;

function clientReturning(response: () => Promise<Response>) {
  return createApiClient({ baseUrl: "http://api.test", fetch: response });
}

/** A clock that hands back these millisecond readings, one per call, repeating the last. */
function stepClock(...readings: number[]): () => number {
  let calls = 0;
  return () => readings[Math.min(calls++, readings.length - 1)] ?? 0;
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
    await render(<StatusFooter client={client} now={stepClock(1000, 1042)} />);

    expect(await screen.findByText("ok · v1.4.0")).toBeOnTheScreen();
    expect(calls).toBe(1);

    await fireEvent.press(screen.getByRole("button", { name: "API status: ok · v1.4.0 · 42 ms" }));
    expect(await screen.findByText("ok · v1.4.0")).toBeOnTheScreen();
    expect(calls).toBe(2);
  });

  it('shows "ok · v<version> · <n> ms" and a status-api-latency element labelled "API round trip <n> ms" when the API answers', async () => {
    const client = clientReturning(async () =>
      Response.json({ status: "ok", version: "1.4.0", uptimeSeconds: 12 }),
    );
    await render(<StatusFooter client={client} now={stepClock(1000, 1042.6)} />);

    // The API row reads "ok · v1.4.0 · 43 ms": the version text, then the time.
    expect(await screen.findByText("ok · v1.4.0")).toBeOnTheScreen();
    expect(screen.getByText("· 43 ms")).toBeOnTheScreen();
    expect(screen.getByTestId("status-api-latency")).toHaveAccessibleName("API round trip 43 ms");
    expect(screen.getByTestId("status-api")).toHaveAccessibleName(
      "API status: ok · v1.4.0 · 43 ms",
    );
  });

  it("shows no round trip when the API is offline", async () => {
    const client = clientReturning(() => Promise.reject(new TypeError("Network request failed")));
    await render(<StatusFooter client={client} now={stepClock(1000, 1042)} />);

    expect(await screen.findByText("offline")).toBeOnTheScreen();
    expect(screen.queryByTestId("status-api-latency")).toBeNull();
    expect(screen.getByTestId("status-api")).toHaveAccessibleName("API status: offline");
  });

  it("tapping the API row checks again and shows the new round trip instead of the old one", async () => {
    let calls = 0;
    const client = clientReturning(async () => {
      calls += 1;
      return Response.json({ status: "ok", version: "1.4.0", uptimeSeconds: 12 });
    });
    // First check: 1000 -> 1042 ms (42 ms). Second check after the tap: 2000 -> 2250 ms (250 ms).
    await render(<StatusFooter client={client} now={stepClock(1000, 1042, 2000, 2250)} />);

    expect(await screen.findByTestId("status-api-latency")).toHaveAccessibleName(
      "API round trip 42 ms",
    );

    await fireEvent.press(screen.getByRole("button", { name: "API status: ok · v1.4.0 · 42 ms" }));
    expect(await screen.findByTestId("status-api-latency")).toHaveAccessibleName(
      "API round trip 250 ms",
    );
    expect(screen.queryByText("· 42 ms")).toBeNull();
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
    // e2e/app-platform.ad asserts the label "App version <version> on iOS" on
    // the real app. Read the version pinned in that file and compare it to
    // app.json: drift on either side fails here, not on the device lane.
    const adSource = readFileSync(join(__dirname, "../../../e2e/app-platform.ad"), "utf8");
    const pinned = [...adSource.matchAll(/App version ([0-9][^\s"]*) on iOS/g)].map(
      (match) => match[1],
    );
    // The .ad must pin a version at all, and every pin must be app.json's.
    expect(pinned.length).toBeGreaterThan(0);
    expect([...new Set(pinned)]).toEqual([appJsonVersion]);
  });
});
