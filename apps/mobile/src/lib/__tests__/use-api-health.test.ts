import { createApiClient } from "@apex/contract";

import { checkApiHealth } from "@/lib/use-api-health";

/**
 * A clock the test controls: each call hands out the next time and later calls
 * hold the last one, so a check's start and end are the two times given here.
 */
function clockOf(...times: number[]) {
  let call = 0;
  return () => {
    const time = times[Math.min(call, times.length - 1)] ?? 0;
    call += 1;
    return time;
  };
}

const healthy = createApiClient({
  baseUrl: "http://api.test",
  fetch: async () => Response.json({ status: "ok", version: "1.4.0", uptimeSeconds: 12 }),
});

describe("checkApiHealth", () => {
  it("the health check reports the round trip of the health request in whole milliseconds", async () => {
    // The clock steps 42.7 ms between the request going out and the parsed answer.
    const result = await checkApiHealth(healthy, clockOf(1000, 1042.7));

    expect(result).toEqual({ state: "ok", version: "1.4.0", latencyMs: 43 });
  });
});
