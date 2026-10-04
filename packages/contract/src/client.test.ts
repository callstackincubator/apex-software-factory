import { describe, expect, it } from "vitest";
import { ApiError, createApiClient } from "./client.ts";

function fakeFetch(status: number, body: unknown): typeof fetch {
  return async (input) => {
    expect(String(input)).toBe("http://api.test/health");
    return new Response(JSON.stringify(body), { status });
  };
}

describe("createApiClient", () => {
  it("returns the parsed health payload", async () => {
    const client = createApiClient({
      baseUrl: "http://api.test/",
      fetch: fakeFetch(200, { status: "ok", version: "1.2.3", uptimeSeconds: 5 }),
    });
    await expect(client.health()).resolves.toEqual({
      status: "ok",
      version: "1.2.3",
      uptimeSeconds: 5,
    });
  });

  it("throws ApiError carrying the status on a non-2xx response", async () => {
    const client = createApiClient({ baseUrl: "http://api.test", fetch: fakeFetch(503, {}) });
    await expect(client.health()).rejects.toMatchObject({ name: "ApiError", status: 503 });
    await expect(client.health()).rejects.toBeInstanceOf(ApiError);
  });

  it("rejects a payload that breaks the contract", async () => {
    const client = createApiClient({
      baseUrl: "http://api.test",
      fetch: fakeFetch(200, { status: "degraded", version: "1", uptimeSeconds: 1 }),
    });
    await expect(client.health()).rejects.toThrow();
  });
});
