import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { Hono } from "hono";
import { z } from "zod";
import { RunRequest, Window } from "../shared/schema.ts";
import { buildDetail, buildSnapshot } from "./derive/deliveries.ts";
import type { Collected } from "./derive/deliveries.ts";
import { OpencodeUnavailable, type OpencodeCli } from "./opencode-cli.ts";
import type { AutomationsCollector, Collector } from "./service.ts";
import { buildAutomationDetail, buildAutomations, dispatchRefusal } from "./derive/automations.ts";

export interface AppDeps {
  port: number;
  demo: boolean;
  /** The built page; `index.html` is served for a path with no extension. */
  distDir: string;
  collector: Collector;
  automations: AutomationsCollector;
  opencode: OpencodeCli;
  /** Dispatches `factory.yml` for the issue in the repository. */
  dispatch: (repo: string, issue: number) => Promise<void>;
  /** Dispatches a workflow on the default branch. */
  dispatchWorkflow: (repo: string, file: string) => Promise<void>;
}

const MIME: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".map": "application/json; charset=utf-8",
};

/** Builds the HTTP app. Pure: no ports, no env reads, no I/O at import. `main.ts` does those. */
export function createApp(deps: AppDeps) {
  const app = new Hono();
  const hosts = new Set([`127.0.0.1:${deps.port}`, `localhost:${deps.port}`, `[::1]:${deps.port}`]);
  const origins = new Set([...hosts].map((h) => `http://${h}`));

  // Guard, for every request: a loopback Host, and for a POST the console's own Origin.
  app.use(async (c, next) => {
    if (!hosts.has(c.req.header("host") ?? "")) {
      return c.json({ error: "unexpected Host header" }, 421);
    }
    if (c.req.method === "POST" && !origins.has(c.req.header("origin") ?? "")) {
      return c.json({ error: "unexpected Origin" }, 403);
    }
    await next();
  });

  const snapshotOf = async (window: Window) => {
    const collected = await deps.collector.collect();
    const cli = await deps.opencode.info();
    return { collected, snapshot: buildSnapshot(collected, window, cli) };
  };

  app.get("/api/snapshot", async (c) => {
    const window = Window.safeParse(c.req.query("window") ?? "7d");
    if (!window.success) return c.json({ error: "window must be today, 7d or all" }, 400);
    return c.json((await snapshotOf(window.data)).snapshot);
  });

  app.get("/api/deliveries/:issue", async (c) => {
    const issue = Number(c.req.param("issue"));
    if (!Number.isInteger(issue) || issue <= 0)
      return c.json({ error: "not an issue number" }, 400);
    const detail = buildDetail(await deps.collector.collect(), issue);
    if (!detail) return c.json({ error: `no delivery for #${issue}` }, 404);
    return c.json(detail);
  });

  app.post("/api/runs", async (c) => {
    if (deps.demo) return c.json({ error: "demo mode" }, 409);
    const body = RunRequest.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: z.prettifyError(body.error) }, 400);
    const { issue } = body.data;
    const collected: Collected = await deps.collector.collect();
    const refusal = refusalFor(collected, issue);
    if (refusal !== null) return c.json({ error: refusal }, 409);
    if (collected.repo === null) return c.json({ error: "the repository is unknown" }, 503);
    try {
      await deps.dispatch(collected.repo, issue);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 502);
    }
    return c.json({ dispatched: true, issue }, 202);
  });

  app.get("/api/automations", async (c) =>
    c.json(buildAutomations(await deps.automations.collect())),
  );

  app.get("/api/automations/:file", async (c) => {
    const detail = buildAutomationDetail(await deps.automations.collect(), c.req.param("file"));
    return detail ? c.json(detail) : c.json({ error: `no workflow ${c.req.param("file")}` }, 404);
  });

  app.post("/api/automations/:file/dispatch", async (c) => {
    if (deps.demo) return c.json({ error: "demo mode" }, 409);
    const read = await deps.automations.collect();
    const file = read.files.find((f) => f.file === c.req.param("file"));
    if (!file) return c.json({ error: `no workflow ${c.req.param("file")}` }, 404);
    const refusal = dispatchRefusal(file, read.states.get(file.file) ?? "unknown");
    if (refusal !== null) return c.json({ error: refusal }, 409);
    if (read.repo === null) return c.json({ error: "the repository is unknown" }, 503);
    try {
      await deps.dispatchWorkflow(read.repo, file.file);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 502);
    }
    return c.json({ dispatched: true, file: file.file }, 202);
  });

  app.post("/api/opencode", async (c) => {
    if (deps.demo) return c.json({ error: "demo mode" }, 409);
    try {
      return c.json(await deps.opencode.pair());
    } catch (error) {
      if (error instanceof OpencodeUnavailable) return c.json({ error: error.message }, 503);
      throw error;
    }
  });

  app.get("/api/*", (c) => c.json({ error: "not found" }, 404));

  app.get("/*", async (c) => {
    const path = decodeURIComponent(new URL(c.req.url).pathname);
    // A page route has no extension, except `/automations/<file>.yml`: the file name is the id.
    const isPage = path.startsWith("/automations/");
    const ext = isPage ? "" : extname(path);
    const relative = ext === "" ? "index.html" : normalize(path).replace(/^([/\\])+/, "");
    const file = join(deps.distDir, relative);
    if (!file.startsWith(deps.distDir.endsWith(sep) ? deps.distDir : deps.distDir + sep)) {
      return c.text("not found", 404);
    }
    try {
      const data = await readFile(file);
      return c.body(new Uint8Array(data), 200, {
        "content-type": MIME[extname(file)] ?? "application/octet-stream",
        "cache-control": relative.startsWith("assets")
          ? "public, max-age=31536000, immutable"
          : "no-cache",
      });
    } catch {
      return ext === ""
        ? c.text("The page is not built: run `pnpm console` (it builds the page first).", 503)
        : c.text("not found", 404);
    }
  });

  app.onError((error, c) => c.json({ error: error.message }, 500));
  return app;
}

/** Why a run cannot be started for the issue (CONSOLE.md 3), or null when it can. */
export function refusalFor(collected: Collected, issue: number): string | null {
  const delivery = buildSnapshot(collected, "all", { available: false }).deliveries.find(
    (d) => d.issue === issue,
  );
  if (!delivery) {
    return `#${issue} is not an open issue with a ready or triage label`;
  }
  if (!delivery.open) return `#${issue} is closed`;
  if (delivery.state === "running" || delivery.state === "queued") {
    return `#${issue} already has a ${delivery.state} factory run`;
  }
  const labelled = delivery.labels.some(
    (l) => /^(feature|task|bug):ready$/.test(l) || l === "bug:triage",
  );
  if (!labelled) return `#${issue} carries no ready or triage label`;
  return null;
}

export type App = ReturnType<typeof createApp>;
