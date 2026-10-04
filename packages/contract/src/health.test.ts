import { describe, expect, it } from "vitest";
import { HealthResponse } from "./health.ts";

describe("HealthResponse", () => {
  it("rejects a negative uptime", () => {
    const result = HealthResponse.safeParse({ status: "ok", version: "1.0.0", uptimeSeconds: -1 });
    expect(result.success).toBe(false);
  });

  it("accepts a well-formed payload", () => {
    const result = HealthResponse.safeParse({ status: "ok", version: "1.0.0", uptimeSeconds: 3 });
    expect(result.success).toBe(true);
  });
});
