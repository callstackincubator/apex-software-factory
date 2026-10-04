import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { ConfigError, loadConfig, type Config } from "./config.ts";
import { createLogger } from "./logger.ts";

let config: Config;
try {
  config = loadConfig();
} catch (error) {
  if (!(error instanceof ConfigError)) throw error;
  console.error(error.message);
  process.exit(1);
}

const logger = createLogger(config.logLevel);
const app = createApp({ config, logger });

const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  logger.info(
    { address: info.address, port: info.port, version: config.appVersion },
    `listening on http://${config.host}:${info.port} (docs at /docs)`,
  );
});

let shuttingDown = false;

function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "shutting down: draining in-flight requests");

  const forceExit = setTimeout(() => {
    logger.warn({ timeoutMs: config.shutdownTimeoutMs }, "drain timed out, forcing exit");
    process.exit(1);
  }, config.shutdownTimeoutMs);
  forceExit.unref();

  // Stops accepting connections and closes idle keep-alive sockets; the
  // callback fires once every in-flight request has finished.
  server.close((error) => {
    if (error) {
      logger.error({ err: error }, "error while closing server");
      process.exit(1);
    }
    logger.info("server closed");
    process.exit(0);
  });
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
