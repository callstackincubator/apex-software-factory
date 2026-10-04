import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import type { Logger } from "pino";
import { HOT_UPDATER_BASE_PATH, type OtaHotUpdater } from "./hot-updater.ts";

export interface AppOptions {
  readonly hotUpdater: OtaHotUpdater;
  /** Bearer token required on `/hot-updater/api/*` (bundle management). */
  readonly authToken: string;
  readonly logger?: Logger;
}

/**
 * The HTTP surface of the OTA server. Pure: everything it needs is passed in,
 * so tests drive it with `app.request()` and no port.
 *
 * - `GET /hot-updater/version` and the update-check routes
 *   (`/hot-updater/fingerprint/*`, `/hot-updater/app-version/*`) are public —
 *   devices call them.
 * - `/hot-updater/api/*` is the management API used by `hot-updater deploy`
 *   and `hot-updater console`; it requires `Authorization: Bearer <token>`.
 */
export function createApp({ hotUpdater, authToken, logger }: AppOptions): Hono {
  const app = new Hono();

  if (logger) {
    app.use(async (c, next) => {
      const started = performance.now();
      await next();
      logger.info(
        {
          method: c.req.method,
          path: c.req.path,
          status: c.res.status,
          ms: Math.round(performance.now() - started),
        },
        "request",
      );
    });
  }

  app.get("/health", (c) => c.json({ status: "ok" }));

  app.use(`${HOT_UPDATER_BASE_PATH}/api/*`, bearerAuth({ token: authToken }));

  // Not `app.mount()`: the handler drops its context when called with Hono's
  // extra mount arguments, and the context carries the device's request,
  // which `S3_PUBLIC_ENDPOINT=auto` needs to sign LAN download URLs.
  app.all(`${HOT_UPDATER_BASE_PATH}/*`, (c) =>
    hotUpdater.handler(c.req.raw, { request: c.req.raw }),
  );

  return app;
}
