import { HealthResponse } from "@apex/contract";
import { describe, expect, it } from "vitest";
import worker from "./worker.ts";

describe("Worker entry", () => {
  it("reads its configuration from the env bindings", async () => {
    const res = await worker.fetch(new Request("https://api.test/health"), {
      APP_VERSION: "3.4.5-binding",
    });

    expect(res.status).toBe(200);
    expect(HealthResponse.parse(await res.json()).version).toBe("3.4.5-binding");
  });
});
