import { createApp } from "./app.ts";
import { loadConfig, type Env } from "./config.ts";
import { createLogger } from "./logger.ts";

export default {
  fetch(request: Request, env: Env) {
    const config = loadConfig(env);
    return createApp({ config, logger: createLogger(config.logLevel) }).fetch(request);
  },
};
