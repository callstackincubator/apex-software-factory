import { serve } from "@hono/node-server";
import { pino } from "pino";
import { createApp } from "./app.ts";
import { loadConfig, loadDotEnv } from "./config.ts";
import { HOT_UPDATER_BASE_PATH, createOtaHotUpdater, openDatabase } from "./hot-updater.ts";
import { createS3Storage } from "./storage.ts";

const SHUTDOWN_TIMEOUT_MS = 10_000;

loadDotEnv();
const config = loadConfig(process.env);
const logger = pino({ level: config.logLevel, base: { service: "ota-server" } });

const db = openDatabase(config.databasePath);
const hotUpdater = createOtaHotUpdater({ db, storages: [createS3Storage(config.s3)] });
const app = createApp({ hotUpdater, authToken: config.authToken, logger });

const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
  logger.info(
    {
      url: `http://${info.address}:${info.port}${HOT_UPDATER_BASE_PATH}`,
      database: config.databasePath,
      s3Endpoint: config.s3.endpoint,
      s3PublicEndpoint: config.s3.publicEndpoint,
      bucket: config.s3.bucket,
    },
    "ota-server listening",
  );
});

let shuttingDown = false;
function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "draining in-flight requests");
  const force = setTimeout(() => {
    logger.error("shutdown timed out; exiting");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  force.unref();
  server.close((error) => {
    void db.destroy().finally(() => {
      if (error) logger.error({ err: error }, "server close failed");
      logger.info("ota-server stopped");
      process.exit(error ? 1 : 0);
    });
  });
  // Keep-alive sockets with no request in flight would hold close() open.
  if ("closeIdleConnections" in server) server.closeIdleConnections();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
