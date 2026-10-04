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

  /** A one-chunk byte stream carrying this exact text, delivered in full on demand. */
  function stringStream(text: string): ReadableStream<Uint8Array> {
    const bytes = new TextEncoder().encode(text);
    return new ReadableStream<Uint8Array>({
      type: "bytes",
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
  }

  /** A body stream that errors as soon as it is read, never delivering anything. */
  function failingStream(): ReadableStream<Uint8Array> {
    return new ReadableStream<Uint8Array>({
      type: "bytes",
      pull(controller) {
        controller.error(new Error("connection reset"));
      },
    });
  }

  /** A fetch that answers every request with a bodyless response. */
  function noBodyFetch(status: number): typeof fetch {
    return async (input) => {
      expect(String(input)).toBe("http://api.test/health");
      return new Response(null, { status });
    };
  }

  it("ApiError does not parse an error body longer than 16384 bytes", async () => {
    const body = oversizedErrorBody();
    expect(new TextEncoder().encode(body).byteLength).toBeGreaterThan(16384);
    expect(ErrorResponse.safeParse(JSON.parse(body)).success).toBe(true);
    // No content-length: the client reads, finds the body over the cap, and refuses to parse it.
    // The body itself is streamed — a valid ErrorResponse — so only the refusal to parse
    // keeps its code and message out of the error.
    const error = await healthError(
      streamErrorFetch(413, stringStream(body), { "x-request-id": "req-oversized" }),
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

  it("ApiError falls back to the status message when the error response has no body", async () => {
    const client = createApiClient({
      baseUrl: "http://api.test",
      fetch: async (input) => {
        expect(String(input)).toBe("http://api.test/health");
        return new Response(null, { status: 503, headers: { "x-request-id": "req-nobody" } });
      },
    });
    const error = await client.health().then(
      () => undefined,
      (thrown: unknown) => thrown,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      message: "GET /health failed with 503",
      code: undefined,
      details: undefined,
      requestId: "req-nobody",
    });
  });

  it("ApiError falls back to the status message when reading the error body fails", async () => {
    // The stream errors mid-read: the client must reject with the fallback
    // ApiError, never with the stream's own error.
    const broken = new ReadableStream<Uint8Array>({
      type: "bytes",
      pull(controller) {
        controller.error(new Error("connection reset"));
      },
    });
    const error = await healthError(streamErrorFetch(500, broken));
    expect(error.message).toBe("GET /health failed with 500");
    expect(error.code).toBeUndefined();
    expect(error.status).toBe(500);
  });

  it("ApiError keeps its status and name for every kind of error body listed above", async () => {
    // One entry per kind of error body in the Tests list above, each carried by
    // the fetch that produces it — string body, streamed body, no body, failing stream.
    const kinds: Array<{ status: number; fetch: () => typeof fetch }> = [
      {
        // a JSON body that matches ErrorResponse, with details
        status: 422,
        fetch: () =>
          errorFetch(
            422,
            JSON.stringify({
              error: {
                code: "validation_failed",
                message: "bad input",
                requestId: "req-1",
                details: [{ path: ["a"], message: "why" }],
              },
            }),
          ),
      },
      {
        // a JSON body that matches ErrorResponse, request id from the header
        status: 404,
        fetch: () =>
          errorFetch(
            404,
            JSON.stringify({ error: { code: "not_found", message: "no such thing" } }),
            { "x-request-id": "req-header-1" },
          ),
      },
      {
        // a body that is not JSON
        status: 502,
        fetch: () => errorFetch(502, "<html>bad gateway</html>"),
      },
      {
        // a JSON body that does not match ErrorResponse
        status: 500,
        fetch: () => errorFetch(500, JSON.stringify({ errors: ["nope"] })),
      },
      {
        // a JSON body that matches, with both a body request id and a header
        status: 403,
        fetch: () =>
          errorFetch(
            403,
            JSON.stringify({
              error: { code: "forbidden", message: "no", requestId: "req-2" },
            }),
            { "x-request-id": "req-header-2" },
          ),
      },
      {
        // a streamed body longer than 16384 bytes, read but not parsed
        status: 413,
        fetch: () => streamErrorFetch(413, stringStream(oversizedErrorBody())),
      },
      {
        // a streamed body over the cap, reading stopped past 16384 bytes
        status: 507,
        fetch: () => streamErrorFetch(507, countingStream(10, 4096).stream),
      },
      {
        // a body whose content-length is over 16384 bytes, never read
        status: 414,
        fetch: () =>
          streamErrorFetch(414, countingStream(10, 4096).stream, { "content-length": "40960" }),
      },
      {
        // no body at all
        status: 503,
        fetch: () => noBodyFetch(503),
      },
      {
        // a body stream that errors while it is read
        status: 509,
        fetch: () => streamErrorFetch(509, failingStream()),
      },
    ];
    for (const { status, fetch } of kinds) {
      const error = await healthError(fetch());
      expect(error.status).toBe(status);
      expect(error.name).toBe("ApiError");
    }
  });
});
