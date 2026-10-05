import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { ConfigError, loadConfig, type Config } from "./config.ts";
import { demoCollector } from "./demo.ts";
import { dispatchRun, ghRunner, resolveRepo } from "./github.ts";
import { openOpencodeDb } from "./opencode-db.ts";
import { createOpencodeCli } from "./opencode-cli.ts";
import { discoverRunLogDirs } from "./run-logs.ts";
import { createAutomationsCollector, createCollector } from "./service.ts";
import { demoAutomations } from "./demo.ts";
import { dispatchWorkflow } from "./workflows.ts";
import { join } from "node:path";

let config: Config;
try {
  config = loadConfig();
} catch (error) {
  if (!(error instanceof ConfigError)) throw error;
  console.error(error.message);
  process.exit(1);
}

const gh = ghRunner(config.repoRoot);
// Resolved once, not on every refresh: each `gh repo view` is a request against the hourly
// API limit. Without a gh login it stays unset and each refresh says why.
const repo = config.demo
  ? config.repo
  : (config.repo ?? (await resolveRepo(gh, undefined).catch(() => undefined)));
const db = openOpencodeDb(config.opencodeDb);
const opencode = config.demo
  ? {
      info: async () => ({ available: true, version: "2.0.22" }),
      pair: async () => {
        throw new Error("demo mode");
      },
    }
  : createOpencodeCli({ cwd: config.repoRoot });
const collector = config.demo
  ? demoCollector()
  : createCollector({
      now: Date.now,
      gh,
      repo,
      db,
      runLogDirs: () => config.runLogDirs ?? discoverRunLogDirs(config.home, config.repoRoot),
    });

const workflowsDir = join(config.repoRoot, ".github", "workflows");
const automations = config.demo
  ? demoAutomations(workflowsDir)
  : createAutomationsCollector({ now: Date.now, gh, repo, workflowsDir });

const app = createApp({
  automations,
  dispatchWorkflow: (repo, file) => dispatchWorkflow(gh, repo, file),
  port: config.port,
  demo: config.demo,
  distDir: config.distDir,
  collector,
  opencode,
  dispatch: (repo, issue) => dispatchRun(gh, repo, issue),
});

const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  console.log(
    `Apex factory console on http://${config.host === "::1" ? "[::1]" : config.host}:${info.port}${config.demo ? " (demo data)" : ""}`,
  );
});
server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code !== "EADDRINUSE") throw error;
  console.error(
    `Port ${config.port} on ${config.host} is in use: another console may be running. Set CONSOLE_PORT to use another port.`,
  );
  process.exit(1);
});

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  db.close();
  const force = setTimeout(() => process.exit(1), 3_000);
  force.unref();
  server.close(() => process.exit(0));
  // Keep-alive sockets of the page's polling would hold the close open.
  (server as { closeAllConnections?: () => void }).closeAllConnections?.();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
