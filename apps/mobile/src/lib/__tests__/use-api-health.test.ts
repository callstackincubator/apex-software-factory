import { checkApiHealth } from "@/lib/use-api-health";

describe("checkApiHealth", () => {
  it("the health check reports the round trip of the health request in whole milliseconds", async () => {
    // A fixed clock the check takes as a parameter: the request and its parse
    // take 42.6 ms on it, and the reported time is rounded to a whole ms.
    let t = 0;
    const now = () => t;
    const client = {
      health: async () => {
        t = 42.6;
        return { status: "ok" as const, version: "0.1.0", uptimeSeconds: 1 };
      },
    };

    expect(await checkApiHealth(client, now)).toEqual({
      state: "ok",
      version: "0.1.0",
      latencyMs: 43,
    });
  });

  it("the health check reports no round trip when the request fails", async () => {
    const client = {
      health: async () => {
        throw new TypeError("Network request failed");
      },
    };

    expect(await checkApiHealth(client, () => 0)).toEqual({ state: "offline" });
  });
});
