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

/** A valid ErrorResponse body padded past the 16384-byte read limit. */
function oversizedErrorBody(): string {
  return JSON.stringify({
    error: { code: "validation_failed", message: "too large to trust", requestId: "req-from-body" },
    pad: "x".repeat(16385),
  });
}

/**
 * A byte stream of `chunks` chunks of `size` bytes each, demand-driven, tracking
 * how many bytes it has delivered and whether the consumer cancelled it — so a
 * test can prove the client stopped reading and let go of the stream.
 */
function countingStream(
  chunks: number,
  size: number,
): {
  stream: ReadableStream<Uint8Array>;
  delivered: () => number;
  cancelled: () => boolean;
} {
  let delivered = 0;
  let cancelled = false;
  let remaining = chunks;
  const stream = new ReadableStream({
    type: "bytes",
    pull(controller) {
      if (remaining-- <= 0) {
        controller.close();
        return;
      }
      const chunk = new TextEncoder().encode("x".repeat(size));
      delivered += chunk.byteLength;
      controller.enqueue(chunk);
    },
    cancel() {
      cancelled = true;
    },
  });
  return { stream, delivered: () => delivered, cancelled: () => cancelled };
}

/** A fetch that answers every request with this streamed error body (no content-length inferred). */
function streamErrorFetch(
  status: number,
  stream: ReadableStream<Uint8Array>,
  headers: Record<string, string> = {},
): typeof fetch {
  return async (input) => {
    expect(String(input)).toBe("http://api.test/health");
    return new Response(stream, { status, headers });
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

  it("ApiError prefers the body's request id over the x-request-id header when both are present", async () => {
    const body = {
      error: { code: "not_found", message: "no such thing", requestId: "req-from-body" },
    };
    const error = await healthError(
      errorFetch(404, JSON.stringify(body), { "x-request-id": "req-from-header" }),
    );
    expect(error.requestId).toBe("req-from-body");
  });

  it("ApiError does not parse an error body longer than 16384 bytes", async () => {
    const body = oversizedErrorBody();
    expect(new TextEncoder().encode(body).byteLength).toBeGreaterThan(16384);
    expect(ErrorResponse.safeParse(JSON.parse(body)).success).toBe(true);
    // No content-length: the client reads, finds the body over the cap, and refuses to parse it.
    const counted = countingStream(1, new TextEncoder().encode(body).byteLength);
    const error = await healthError(
      streamErrorFetch(413, counted.stream, { "x-request-id": "req-oversized" }),
    );
    expect(error.message).toBe("GET /health failed with 413");
    expect(error.code).toBeUndefined();
    expect(error.requestId).toBe("req-oversized");
  });

  it("ApiError stops reading an error body after 16384 bytes", async () => {
    // No content-length: ten 4096-byte chunks, 40960 bytes in all. The client must
    // stop pulling once more than 16384 bytes have arrived, not drain the stream.
    const counted = countingStream(10, 4096);
    const error = await healthError(streamErrorFetch(500, counted.stream));
    expect(counted.delivered()).toBeLessThanOrEqual(20480);
    expect(counted.cancelled()).toBe(true);
    expect(error.message).toBe("GET /health failed with 500");
    expect(error.code).toBeUndefined();
    expect(error.status).toBe(500);
  });

  it("ApiError does not read an error body whose content-length is over 16384 bytes", async () => {
    const counted = countingStream(10, 4096);
    const error = await healthError(
      streamErrorFetch(413, counted.stream, {
        "content-length": "40960",
        "x-request-id": "req-refused",
      }),
    );
    expect(counted.delivered()).toBe(0);
    expect(counted.cancelled()).toBe(true);
    expect(error.message).toBe("GET /health failed with 413");
    expect(error.code).toBeUndefined();
    expect(error.requestId).toBe("req-refused");
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
