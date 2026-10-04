import { describe, expect, it } from "vitest";
import { ApiError, createApiClient } from "./client.ts";
import { ErrorResponse } from "./errors.ts";

function fakeFetch(status: number, body: unknown): typeof fetch {
  return async (input) => {
    expect(String(input)).toBe("http://api.test/health");
    return new Response(JSON.stringify(body), { status });
  };
}

/** A fetch that answers every request with this raw error body and headers. */
function errorFetch(
  status: number,
  body: string,
  headers: Record<string, string> = {},
): typeof fetch {
  return async (input) => {
    expect(String(input)).toBe("http://api.test/health");
    return new Response(body, { status, headers });
  };
}

/** Calls `GET /health` and returns the ApiError it rejects with. */
async function healthError(fetchImpl: typeof fetch): Promise<ApiError> {
  const client = createApiClient({ baseUrl: "http://api.test", fetch: fetchImpl });
  const error = await client.health().then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(ApiError);
  return error as ApiError;
}

/** A valid ErrorResponse body padded past the 16384-character parse limit. */
function oversizedErrorBody(): string {
  return JSON.stringify({
    error: { code: "validation_failed", message: "too large to trust", requestId: "req-from-body" },
    pad: "x".repeat(16385),
  });
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

  it("ApiError carries the code, message, request id and details of a JSON error body that matches ErrorResponse", async () => {
    const body = {
      error: {
        code: "validation_failed",
        message: "uptimeSeconds must be a positive integer",
        requestId: "req-42",
        details: [{ path: ["uptimeSeconds"], message: "expected positive" }],
      },
    };
    expect(ErrorResponse.safeParse(body).success).toBe(true);
    const error = await healthError(errorFetch(422, JSON.stringify(body)));
    expect(error.message).toBe("uptimeSeconds must be a positive integer");
    expect(error.code).toBe("validation_failed");
    expect(error.requestId).toBe("req-42");
    expect(error.details).toEqual([{ path: ["uptimeSeconds"], message: "expected positive" }]);
  });

  it("ApiError takes the request id from the x-request-id header when the error body has none", async () => {
    const body = { error: { code: "not_found", message: "no such thing" } };
    const error = await healthError(
      errorFetch(404, JSON.stringify(body), { "x-request-id": "req-header-7" }),
    );
    expect(error.requestId).toBe("req-header-7");
    expect(error.code).toBe("not_found");
  });

  it("ApiError falls back to the status message when the error body is not JSON", async () => {
    const error = await healthError(
      errorFetch(502, "<html>bad gateway</html>", { "x-request-id": "req-502" }),
    );
    expect(error.message).toBe("GET /health failed with 502");
    expect(error.code).toBeUndefined();
    expect(error.details).toBeUndefined();
    expect(error.requestId).toBe("req-502");
  });

  it("ApiError falls back to the status message when the JSON error body does not match ErrorResponse", async () => {
    const error = await healthError(
      errorFetch(500, JSON.stringify({ errors: ["nope"] }), { "x-request-id": "req-500" }),
    );
    expect(error.message).toBe("GET /health failed with 500");
    expect(error.code).toBeUndefined();
    expect(error.details).toBeUndefined();
    expect(error.requestId).toBe("req-500");
  });

  it("ApiError does not parse an error body longer than 16384 characters", async () => {
    const body = oversizedErrorBody();
    expect(body.length).toBeGreaterThan(16384);
    expect(ErrorResponse.safeParse(JSON.parse(body)).success).toBe(true);
    const error = await healthError(errorFetch(413, body, { "x-request-id": "req-oversized" }));
    expect(error.message).toBe("GET /health failed with 413");
    expect(error.code).toBeUndefined();
    expect(error.requestId).toBe("req-oversized");
  });

  it("ApiError keeps its status and name for every kind of error body", async () => {
    const bodies: Array<{ status: number; body: string; headers?: Record<string, string> }> = [
      {
        status: 422,
        body: JSON.stringify({
          error: { code: "validation_failed", message: "bad input", requestId: "req-1" },
        }),
      },
      { status: 502, body: "<html>bad gateway</html>" },
      { status: 500, body: JSON.stringify({ errors: ["nope"] }) },
      { status: 413, body: oversizedErrorBody() },
      { status: 503, body: "" },
    ];
    for (const { status, body, headers } of bodies) {
      const error = await healthError(errorFetch(status, body, headers));
      expect(error.status).toBe(status);
      expect(error.name).toBe("ApiError");
    }
  });
});
