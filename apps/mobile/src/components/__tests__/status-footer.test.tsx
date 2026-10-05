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

/**
 * A clock the test controls: each call hands out the next time and later calls
 * hold the last one. One health check takes two calls (start and answer), so
 * 1000 and 1042.7 are a 43 ms round trip.
 */
function clockOf(...times: number[]) {
  let call = 0;
  return () => {
    const time = times[Math.min(call, times.length - 1)] ?? 0;
    call += 1;
    return time;
  };
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
    await render(<StatusFooter client={client} now={clockOf(1000, 1042.7, 2000, 2042.7)} />);

    expect(await screen.findByText("ok · v1.4.0")).toBeOnTheScreen();
    expect(calls).toBe(1);

    await fireEvent.press(screen.getByRole("button", { name: "API status: ok · v1.4.0 · 43 ms" }));
    expect(await screen.findByText("ok · v1.4.0")).toBeOnTheScreen();
    expect(calls).toBe(2);
  });

  it('the footer shows "ok · v1.4.0 · 43 ms" and a status-api-latency element labelled "API round trip 43 ms" when the API answers', async () => {
    const client = clientReturning(async () =>
      Response.json({ status: "ok", version: "1.4.0", uptimeSeconds: 12 }),
    );
    await render(<StatusFooter client={client} now={clockOf(1000, 1042.7)} />);

    // The row shows the version and the time as one line ("ok · v1.4.0 · 43 ms")
    // and reads it as its accessibility label; the time is its own element.
    expect(await screen.findByText("ok · v1.4.0")).toBeOnTheScreen();
    expect(screen.getByTestId("status-api")).toHaveAccessibleName(
      "API status: ok · v1.4.0 · 43 ms",
    );
    const latency = screen.getByTestId("status-api-latency");
    expect(latency).toHaveAccessibleName("API round trip 43 ms");
    expect(latency).toHaveTextContent("· 43 ms");
  });

  it("the footer shows no round trip when the API is offline", async () => {
    const client = clientReturning(() => Promise.reject(new TypeError("Network request failed")));
    await render(<StatusFooter client={client} now={clockOf(1000, 1042.7)} />);

    expect(await screen.findByText("offline")).toBeOnTheScreen();
    expect(screen.getByTestId("status-api")).toHaveAccessibleName("API status: offline");
    expect(screen.queryByTestId("status-api-latency")).toBeNull();
  });

  it("tapping the API row checks again and shows the new round trip instead of the old one", async () => {
    let calls = 0;
    const client = clientReturning(async () => {
      calls += 1;
      return Response.json({ status: "ok", version: "1.4.0", uptimeSeconds: 12 });
    });
    // First check: 1000 → 1042.7 = 43 ms. The one after the tap: 2000 → 3200 =
    // 1200 ms, which stays in milliseconds rather than becoming "1.2 s".
    await render(<StatusFooter client={client} now={clockOf(1000, 1042.7, 2000, 3200)} />);
    await screen.findByLabelText("API round trip 43 ms");
    expect(calls).toBe(1);

    await fireEvent.press(screen.getByRole("button", { name: "API status: ok · v1.4.0 · 43 ms" }));

    expect(await screen.findByLabelText("API round trip 1200 ms")).toBeOnTheScreen();
    expect(screen.queryByLabelText("API round trip 43 ms")).toBeNull();
    expect(screen.getByTestId("status-api")).toHaveAccessibleName(
      "API status: ok · v1.4.0 · 1200 ms",
    );
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
