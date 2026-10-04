import { STATUS_CODES } from "node:http";
import { ErrorResponse } from "@apex/contract";
import type { Hook } from "@hono/zod-openapi";
import type { Context, ErrorHandler, NotFoundHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Logger } from "pino";
import type { AppEnv } from "./context.ts";

/**
 * OpenAPI response entry for an error status. Spread into a route's
 * `responses`: `{ 200: …, ...errorResponse(404, "No such proposal.") }`.
 */
export function errorResponse<S extends number>(status: S, description: string) {
  const entry = { description, content: { "application/json": { schema: ErrorResponse } } };
  return { [status]: entry } as Record<S, typeof entry>;
}

/** Builds the contract's `ErrorResponse`. Throw `HTTPException` from handlers instead of calling this. */
export function errorBody(
  c: Context<AppEnv>,
  code: string,
  message: string,
  details?: unknown,
): ErrorResponse {
  return {
    error: {
      code,
      message,
      requestId: c.var.requestId,
      ...(details === undefined ? {} : { details }),
    },
  };
}

export const handleNotFound: NotFoundHandler<AppEnv> = (c) =>
  c.json(errorBody(c, "not_found", `No route for ${c.req.method} ${c.req.path}`), 404);

/** `HTTPException(404)` → `{ code: "not_found" }`; anything else → a logged, opaque 500. */
export function createErrorHandler(logger: Logger): ErrorHandler<AppEnv> {
  return (err, c) => {
    const log = c.var.logger ?? logger;
    if (err instanceof HTTPException) {
      const statusText = STATUS_CODES[err.status] ?? "Error";
      if (err.status >= 500) log.error({ err }, "request failed");
      const code = statusText.toLowerCase().replaceAll(/[^a-z]+/g, "_");
      return c.json(errorBody(c, code, err.message || statusText), err.status);
    }
    log.error({ err }, "unhandled error");
    return c.json(errorBody(c, "internal_error", "Internal server error"), 500);
  };
}

/** Turns a failed `@hono/zod-openapi` request validation into a 400 `ErrorResponse`. */
// oxlint-disable-next-line typescript/no-explicit-any -- the hook is shared by every route
export const validationHook: Hook<any, AppEnv, any, any> = (result, c) => {
  if (!result.success) {
    return c.json(
      errorBody(c, "validation_failed", "Request validation failed", result.error.issues),
      400,
    );
  }
};
