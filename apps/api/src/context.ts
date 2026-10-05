import type { Logger } from "pino";
import type { Config } from "./config.ts";

// The composition root: main.ts passes real adapters, tests pass fakes.
export type AppDeps = {
  config: Config;
  logger: Logger;
};

export type AppEnv = {
  Variables: {
    requestId: string;
    logger: Logger;
  };
};
