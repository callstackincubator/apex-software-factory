import { createApiClient } from "@apex/contract";
import { fireEvent, render, screen } from "@testing-library/react-native";

import { StatusFooter } from "@/components/status-footer";

// jest-expo's expo-constants mock carries no app config.
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { expoConfig: { version: "1.0.0" } },
}));

function clientReturning(response: () => Promise<Response>) {
  return createApiClient({ baseUrl: "http://api.test", fetch: response });
}

/** A fixed clock the health check reads; each `advance` moves it forward. */
function fixedClock() {
  let t = 0;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

const healthResponse = () => Response.json({ status: "ok", version: "1.4.0", uptimeSeconds: 12 });

describe("StatusFooter", () => {
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
    const clock = fixedClock();
    const client = clientReturning(async () => {
      calls += 1;
      clock.advance(18 * calls);
      return healthResponse();
    });
    await render(<StatusFooter client={client} now={clock.now} />);

    expect(await screen.findByText("ok · v1.4.0 · 18 ms")).toBeOnTheScreen();
    expect(calls).toBe(1);

    await fireEvent.press(screen.getByRole("button", { name: "API status: ok · v1.4.0 · 18 ms" }));
    expect(await screen.findByText("ok · v1.4.0 · 36 ms")).toBeOnTheScreen();
    expect(calls).toBe(2);
  });

  it('the footer shows "ok · v<version> · <n> ms" and a status-api-latency element labelled "API round trip <n> ms" when the API answers', async () => {
    const clock = fixedClock();
    const client = clientReturning(async () => {
      clock.advance(42);
      return healthResponse();
    });
    await render(<StatusFooter client={client} now={clock.now} />);

    // The row's exact text, per the spec: `ok · v0.1.0 · 42 ms`.
    expect(await screen.findByText(/^ok · v1\.4\.0 · 42 ms$/)).toBeOnTheScreen();

    // The time is its own element, selectable by testID, labelled as the spec words it.
    const latency = screen.getByTestId("status-api-latency");
    expect(latency).toBeOnTheScreen();
    expect(latency.props.accessibilityLabel).toBe("API round trip 42 ms");

    // The row's own label states the same line for screen readers.
    expect(
      screen.getByRole("button", { name: "API status: ok · v1.4.0 · 42 ms" }),
    ).toBeOnTheScreen();
  });

  it("the footer shows no round trip when the API is offline", async () => {
    const clock = fixedClock();
    const client = clientReturning(() => Promise.reject(new TypeError("Network request failed")));
    await render(<StatusFooter client={client} now={clock.now} />);

    expect(await screen.findByText("offline")).toBeOnTheScreen();
    expect(screen.queryByTestId("status-api-latency")).toBeNull();
    expect(screen.getByRole("button", { name: "API status: offline" })).toBeOnTheScreen();
  });

  it("tapping the API row checks again and shows the new round trip instead of the old one", async () => {
    let calls = 0;
    const clock = fixedClock();
    const client = clientReturning(async () => {
      calls += 1;
      clock.at(calls === 1 ? 400 : 950);
      return healthResponse();
    });
    await render(<StatusFooter client={client} now={clock.now} />);

    expect(await screen.findByText("ok · v1.4.0 · 400 ms")).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole("button", { name: "API status: ok · v1.4.0 · 400 ms" }));

    // The new time replaces the old one; 400 ms is nowhere on screen — even
    // past the 5 s timeout, a time stays in milliseconds.
    expect(await screen.findByText("ok · v1.4.0 · 950 ms")).toBeOnTheScreen();
    expect(screen.queryByText(/400 ms/)).toBeNull();
    expect(screen.getByTestId("status-api-latency").props.accessibilityLabel).toBe(
      "API round trip 950 ms",
    );
  });

  it("shows the app version and the running bundle", async () => {
    const client = clientReturning(() => Promise.reject(new Error("down")));
    await render(<StatusFooter client={client} />);

    expect(screen.getByText("v1.0.0")).toBeOnTheScreen();
    expect(screen.getByText("embedded · production")).toBeOnTheScreen();
    await screen.findByText("offline");
  });
});
