import { createFakeApiClient, setApiClient } from "@/modules/api";

import { checkApiHealth } from "..";

function clockOf(...times: number[]) {
  let call = 0;
  return () => {
    const time = times[Math.min(call, times.length - 1)] ?? 0;
    call += 1;
    return time;
  };
}

describe("checkApiHealth", () => {
  it("the health check reports the round trip of the health request in whole milliseconds", async () => {
    setApiClient(
      createFakeApiClient(async () =>
        Response.json({ status: "ok", version: "1.4.0", uptimeSeconds: 12 }),
      ),
    );

    const result = await checkApiHealth(clockOf(1000, 1042.7));

    expect(result).toEqual({ state: "ok", version: "1.4.0", latencyMs: 43 });
  });
});
