import type { z } from "zod";
import { ErrorResponse } from "./errors.ts";
import { HealthResponse } from "./health.ts";

export type ApiClientOptions = {
  /** Origin of the API, e.g. `http://localhost:3001`. No trailing slash needed. */
  baseUrl: string;
  fetch?: typeof globalThis.fetch;
};

/** Error bodies longer than this (in bytes) are not read or parsed, per safety rule 3. */
const MAX_ERROR_BODY_BYTES = 16384;

export class ApiError extends Error {
  readonly status: number;
  /** The `error.code` of a JSON body that matches `ErrorResponse`, else undefined. */
  readonly code: string | undefined;
  /** The body's `error.requestId`, else the `x-request-id` header, else undefined. */
  readonly requestId: string | undefined;
  /** The `error.details` of a JSON body that matches `ErrorResponse`, else undefined. */
  readonly details: unknown;

  constructor(
    status: number,
    message: string,
    info?: { code?: string; requestId?: string; details?: unknown },
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = info?.code;
    this.requestId = info?.requestId;
    this.details = info?.details;
  }
}

/** What an error response's body says, as far as it can be trusted. */
function parseErrorBody(text: string): ErrorResponse | undefined {
  try {
    const parsed = ErrorResponse.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The error response's body as UTF-8 text, bounded at the read itself (safety
 * rule 3): refuse on a content-length over the cap, otherwise read the stream
 * and cancel it as soon as more than the cap has arrived. Returns undefined
 * when the body is too large, so it is never parsed.
 */
async function readErrorBody(response: Response): Promise<string | undefined> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_ERROR_BODY_BYTES) {
    await response.body?.cancel();
    return undefined;
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_ERROR_BODY_BYTES) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/** A typed client for the API. Every response is parsed with its contract schema. */
export function createApiClient({ baseUrl, fetch = globalThis.fetch }: ApiClientOptions) {
  const origin = baseUrl.replace(/\/+$/, "");

  async function get<S extends z.ZodType>(path: string, schema: S): Promise<z.infer<S>> {
    const response = await fetch(`${origin}${path}`, { headers: { accept: "application/json" } });
    if (!response.ok) {
      const text = await readErrorBody(response);
      const body = text === undefined ? undefined : parseErrorBody(text);
      const headerRequestId = response.headers.get("x-request-id");
      const requestId = body?.error.requestId ?? headerRequestId ?? undefined;
      const idInfo = requestId === undefined ? {} : { requestId };
      if (body) {
        throw new ApiError(response.status, body.error.message, {
          code: body.error.code,
          ...idInfo,
          details: body.error.details,
        });
      }
      throw new ApiError(response.status, `GET ${path} failed with ${response.status}`, idInfo);
    }
    return schema.parse(await response.json());
  }

  return {
    health: () => get("/health", HealthResponse),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
