import type { MiddlewareHandler } from "hono";
import type { Logger } from "pino";
import type { AppEnv } from "../context.ts";

/**
 * Binds a per-request child logger to `c.var.logger` and logs one line per
 * request once the response is ready. Must run after `requestId()`.
 */
export function requestLogger(logger: Logger): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const log = logger.child({ requestId: c.var.requestId });
    c.set("logger", log);
    const start = performance.now();
    await next();
    log.info(
      {
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        durationMs: Math.round(performance.now() - start),
      },
      "request completed",
    );
  };
}
