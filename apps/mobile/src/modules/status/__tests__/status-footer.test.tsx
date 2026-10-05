import { readFileSync } from "node:fs";
import { join } from "node:path";

import { fireEvent, render, screen } from "@testing-library/react-native";
import { Platform } from "react-native";

import { createFakeApiClient, setApiClient } from "@/modules/api";

import { StatusFooter } from "..";

// jest-expo's expo-constants mock has no app config; the last test ties this version to app.json.
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { expoConfig: { version: "1.0.0" } },
}));

const appJsonVersion: string = require("../../../../app.json").expo.version;

function apiResponds(respond: () => Promise<Response>) {
  setApiClient(createFakeApiClient(respond));
}

// Each call hands out the next time; later calls hold the last. A check takes two calls.
function clockOf(...times: number[]) {
  let call = 0;
  return () => {
    const time = times[Math.min(call, times.length - 1)] ?? 0;
    call += 1;
    return time;
  };
}

describe("StatusFooter", () => {
  const platform = Platform as { OS: string };
  const realOS = platform.OS;
  afterEach(() => {
    platform.OS = realOS;
  });

  it("reports the API as offline when the request fails", async () => {
    apiResponds(() => Promise.reject(new TypeError("Network request failed")));
    await render(<StatusFooter />);

    expect(await screen.findByText("offline")).toBeOnTheScreen();
  });

  it("reports the API as offline when the response breaks the contract", async () => {
    apiResponds(async () => Response.json({ status: "degraded" }));
    await render(<StatusFooter />);

    expect(await screen.findByText("offline")).toBeOnTheScreen();
  });

  it("shows the API version once healthy, and re-checks on press", async () => {
    let calls = 0;
    apiResponds(async () => {
      calls += 1;
      return Response.json({ status: "ok", version: "1.4.0", uptimeSeconds: 12 });
    });
    await render(<StatusFooter now={clockOf(1000, 1042.7, 2000, 2042.7)} />);

    expect(await screen.findByText("ok · v1.4.0")).toBeOnTheScreen();
    expect(calls).toBe(1);

    await fireEvent.press(screen.getByRole("button", { name: "API status: ok · v1.4.0 · 43 ms" }));
    expect(await screen.findByText("ok · v1.4.0")).toBeOnTheScreen();
    expect(calls).toBe(2);
  });

  it('the footer shows "ok · v1.4.0 · 43 ms" and a status-api-latency element labelled "API round trip 43 ms" when the API answers', async () => {
    apiResponds(async () => Response.json({ status: "ok", version: "1.4.0", uptimeSeconds: 12 }));
    await render(<StatusFooter now={clockOf(1000, 1042.7)} />);

    expect(await screen.findByText("ok · v1.4.0")).toBeOnTheScreen();
    expect(screen.getByTestId("status-api")).toHaveAccessibleName(
      "API status: ok · v1.4.0 · 43 ms",
    );
    const latency = screen.getByTestId("status-api-latency");
    expect(latency).toHaveAccessibleName("API round trip 43 ms");
    expect(latency).toHaveTextContent("· 43 ms");
  });

  it("the footer shows no round trip when the API is offline", async () => {
    apiResponds(() => Promise.reject(new TypeError("Network request failed")));
    await render(<StatusFooter now={clockOf(1000, 1042.7)} />);

    expect(await screen.findByText("offline")).toBeOnTheScreen();
    expect(screen.getByTestId("status-api")).toHaveAccessibleName("API status: offline");
    expect(screen.queryByTestId("status-api-latency")).toBeNull();
  });

  it("tapping the API row checks again and shows the new round trip instead of the old one", async () => {
    let calls = 0;
    apiResponds(async () => {
      calls += 1;
      return Response.json({ status: "ok", version: "1.4.0", uptimeSeconds: 12 });
    });
    // 1200 ms stays in milliseconds rather than becoming "1.2 s".
    await render(<StatusFooter now={clockOf(1000, 1042.7, 2000, 3200)} />);
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

  it('the footer shows the app version and "iOS" on iOS, with the label "App version 1.0.0 on iOS"', async () => {
    platform.OS = "ios";
    apiResponds(() => Promise.reject(new Error("down")));
    await render(<StatusFooter />);

    expect(screen.getByText("v1.0.0 · iOS")).toBeOnTheScreen();
    expect(screen.getByTestId("status-app")).toHaveAccessibleName("App version 1.0.0 on iOS");
    expect(screen.getByText("embedded · production")).toBeOnTheScreen();
    await screen.findByText("offline");
  });

  it('the footer shows the app version and "Android" on Android', async () => {
    platform.OS = "android";
    apiResponds(() => Promise.reject(new Error("down")));
    await render(<StatusFooter />);

    expect(screen.getByText("v1.0.0 · Android")).toBeOnTheScreen();
    expect(screen.getByTestId("status-app")).toHaveAccessibleName("App version 1.0.0 on Android");
  });

  it("shows any other platform value as it is", async () => {
    platform.OS = "web";
    apiResponds(() => Promise.reject(new Error("down")));
    await render(<StatusFooter />);

    expect(screen.getByText("v1.0.0 · web")).toBeOnTheScreen();
    expect(screen.getByTestId("status-app")).toHaveAccessibleName("App version 1.0.0 on web");
  });

  it("pins the same app version the e2e script checks on the device", () => {
    const adSource = readFileSync(join(__dirname, "../../../../e2e/app-platform.ad"), "utf8");
    const pinned = [...adSource.matchAll(/App version ([0-9][^\s"]*) on iOS/g)].map(
      (match) => match[1],
    );
    expect(pinned.length).toBeGreaterThan(0);
    expect([...new Set(pinned)]).toEqual([appJsonVersion]);
  });
});
