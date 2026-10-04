import type { Logger } from "pino";
import type { Config } from "./config.ts";

/** What every route module receives. Add shared services (db, clients) here. */
export type AppDeps = {
  config: Config;
  logger: Logger;
};

/** Hono environment: variables set by middleware and readable via `c.var`. */
export type AppEnv = {
  Variables: {
    requestId: string;
    /** Child logger bound to the current request id. */
    logger: Logger;
  };
};
