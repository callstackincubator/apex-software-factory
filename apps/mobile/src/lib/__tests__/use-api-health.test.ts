import { createApiClient } from "@apex/contract";

import { checkApiHealth } from "@/lib/use-api-health";

/** A clock that hands back these millisecond readings, one per call, repeating the last. */
function stepClock(...readings: number[]): () => number {
  let calls = 0;
  return () => readings[Math.min(calls++, readings.length - 1)] ?? 0;
}

function clientReturning(response: () => Promise<Response>) {
  return createApiClient({ baseUrl: "http://api.test", fetch: response });
}

const healthy = () =>
  Promise.resolve(Response.json({ status: "ok", version: "1.4.0", uptimeSeconds: 12 }));

describe("checkApiHealth", () => {
  it("reports the round trip of the health request in whole milliseconds", async () => {
    // The clock reads 1000 ms just before the request and 1042.6 ms once the answer is parsed.
    const health = await checkApiHealth(clientReturning(healthy), stepClock(1000, 1042.6));

    expect(health).toEqual({ state: "ok", version: "1.4.0", latencyMs: 43 });
  });

  it("reports a round trip up to the 5 s timeout in whole milliseconds, never seconds", async () => {
    const health = await checkApiHealth(clientReturning(healthy), stepClock(0, 1200.4));

    expect(health).toEqual({ state: "ok", version: "1.4.0", latencyMs: 1200 });
  });

  it("shows no round trip when the API is offline", async () => {
    const health = await checkApiHealth(
      clientReturning(() => Promise.reject(new TypeError("Network request failed"))),
      stepClock(0),
    );

    expect(health).toEqual({ state: "offline" });
    expect(health).not.toHaveProperty("latencyMs");
  });
});
