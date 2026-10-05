import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeliveryDetail, Snapshot } from "../shared/schema.ts";
import { createApp, type AppDeps } from "./app.ts";
import type { Collected } from "./derive/deliveries.ts";
import { demoChat, demoCollector } from "./demo.ts";
import { ghRunner, GhError, type GhRunner } from "./github.ts";
import { openOpencodeDb } from "./opencode-db.ts";
import { OpencodeUnavailable, type OpencodeCli } from "./opencode-cli.ts";
import { createCollector } from "./service.ts";
import { collected, factoryRun, issueRecord, NOW } from "./test-support.ts";

const PORT = 4280;
const LOCAL = { host: `127.0.0.1:${PORT}` };
const POST = {
  method: "POST",
  headers: {
    host: `127.0.0.1:${PORT}`,
    origin: `http://127.0.0.1:${PORT}`,
    "content-type": "application/json",
  },
};

const temp: string[] = [];
afterEach(() => {
  while (temp.length > 0) rmSync(temp.pop() ?? "", { recursive: true, force: true });
});

function fakeCli(pair?: OpencodeCli["pair"]): OpencodeCli {
  return {
    info: async () => ({ available: true, version: "2.0.22" }),
    pair:
      pair ??
      (async () => ({ url: "http://127.0.0.1:4096/auth/connect/AbC123", expiresInMinutes: 5 })),
  };
}

function makeApp(data: Collected, over: Partial<AppDeps> = {}) {
  const dispatch = vi.fn(async () => {});
  const app = createApp({
    port: PORT,
    demo: false,
    distDir: "/nonexistent",
    collector: { collect: async () => data },
    opencode: fakeCli(),
    chat: demoChat(),
    automations: {
      collect: async () => ({
        now: NOW,
        repo: "o/r",
        files: [],
        states: new Map(),
        runs: new Map(),
        notes: [],
      }),
    },
    dispatchWorkflow: async () => {},
    dispatch,
    ...over,
  });
  return { app, dispatch };
}

const get = (
  app: ReturnType<typeof makeApp>["app"],
  path: string,
  headers: Record<string, string> = LOCAL,
) => app.request(path, { headers });

const postRun = (app: ReturnType<typeof makeApp>["app"], body: unknown) =>
  app.request("/api/runs", { ...POST, body: JSON.stringify(body) });

describe("GET /api/snapshot", () => {
  it("validates against the snapshot schema", async () => {
    const { app } = makeApp(
      collected({
        issues: [issueRecord({ number: 5, labels: ["feature:ready"] })],
        runs: [factoryRun({ id: 1, issue: 6, status: "in_progress", conclusion: null })],
      }),
    );

    const res = await get(app, "/api/snapshot");

    expect(res.status).toBe(200);
    const snapshot = Snapshot.parse(await res.json());
    expect(snapshot.deliveries.map((d) => [d.issue, d.state])).toEqual(
      expect.arrayContaining([
        [5, "ready"],
        [6, "running"],
      ]),
    );
  });

  it("validates the demo snapshot and the detail of every demo delivery", async () => {
    const { app } = makeApp(collected({}), { demo: true, collector: demoCollector(() => NOW) });

    const snapshot = Snapshot.parse(await (await get(app, "/api/snapshot?window=all")).json());
    expect(snapshot.deliveries.length).toBeGreaterThanOrEqual(8);
    for (const delivery of snapshot.deliveries) {
      const res = await get(app, `/api/deliveries/${delivery.issue}`);
      expect(res.status, `delivery #${delivery.issue}`).toBe(200);
      expect(DeliveryDetail.parse(await res.json()).delivery.issue).toBe(delivery.issue);
    }
  });

  it("rejects a window it does not know", async () => {
    const res = await get(makeApp(collected({})).app, "/api/snapshot?window=year");

    expect(res.status).toBe(400);
  });

  it("sends no CORS header", async () => {
    const res = await makeApp(collected({})).app.request("/api/snapshot", {
      headers: { ...LOCAL, origin: "http://evil.example" },
    });

    expect([...res.headers.keys()].filter((k) => k.startsWith("access-control-"))).toEqual([]);
  });
});

describe("GET /api/deliveries/:issue", () => {
  it("answers 404 for an issue the console has no delivery for", async () => {
    const res = await get(makeApp(collected({})).app, "/api/deliveries/99");

    expect(res.status).toBe(404);
  });

  it("answers 400 for something that is not an issue number", async () => {
    const res = await get(makeApp(collected({})).app, "/api/deliveries/abc");

    expect(res.status).toBe(400);
  });
});

describe("the guard", () => {
  it("answers 421 for a Host that is not a loopback name on the port, on any route", async () => {
    const { app } = makeApp(collected({}));

    for (const host of ["evil.com", `evil.com:${PORT}`, "127.0.0.1:9999", "127.0.0.1", ""]) {
      const res = await app.request("/api/snapshot", { headers: { host } });
      expect(res.status, `Host ${host}`).toBe(421);
    }
    expect((await app.request("/pipeline", { headers: { host: "evil.com" } })).status).toBe(421);
  });

  it("serves both loopback names on the port", async () => {
    const { app } = makeApp(collected({}));

    for (const host of [`127.0.0.1:${PORT}`, `localhost:${PORT}`]) {
      expect((await app.request("/api/snapshot", { headers: { host } })).status).toBe(200);
    }
  });

  it("answers 403 for a POST whose Origin is not the console's own, or is missing", async () => {
    const { app, dispatch } = makeApp(
      collected({ issues: [issueRecord({ number: 1, labels: ["bug:ready"] })] }),
    );
    const post = (origin?: string) =>
      app.request("/api/runs", {
        method: "POST",
        headers: { ...LOCAL, "content-type": "application/json", ...(origin ? { origin } : {}) },
        body: JSON.stringify({ issue: 1 }),
      });

    expect((await post("http://evil.example")).status).toBe(403);
    expect((await post(`http://127.0.0.1:${PORT + 1}`)).status).toBe(403);
    expect((await post()).status).toBe(403);
    expect(dispatch).not.toHaveBeenCalled();
    expect((await post(`http://localhost:${PORT}`)).status).toBe(202);
  });

  it("checks the Host before the Origin", async () => {
    const res = await makeApp(collected({})).app.request("/api/runs", {
      method: "POST",
      headers: { host: "evil.com", origin: "http://evil.com" },
    });

    expect(res.status).toBe(421);
  });
});

describe("POST /api/runs", () => {
  it("dispatches factory.yml with the exact gh arguments and answers 202", async () => {
    const calls: string[][] = [];
    const gh: GhRunner = async (args) => {
      calls.push([...args]);
      return "";
    };
    const { dispatchRun } = await import("./github.ts");
    const { app } = makeApp(
      collected({ issues: [issueRecord({ number: 12, labels: ["feature:ready"] })] }),
      {
        dispatch: (repo, issue) => dispatchRun(gh, repo, issue),
      },
    );

    const res = await postRun(app, { issue: 12 });

    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ dispatched: true, issue: 12 });
    expect(calls).toEqual([["workflow", "run", "factory.yml", "--repo", "o/r", "-f", "issue=12"]]);
  });

  it("refuses a closed issue with 409 and the reason", async () => {
    const { app, dispatch } = makeApp(
      collected({
        issues: [
          issueRecord({ number: 3, labels: ["feature:ready"], open: false, closedAt: NOW - 1000 }),
        ],
        runs: [factoryRun({ id: 1, issue: 3 })],
      }),
    );

    const res = await postRun(app, { issue: 3 });

    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("closed");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("refuses an issue that already has a running run", async () => {
    const { app, dispatch } = makeApp(
      collected({
        issues: [issueRecord({ number: 4, labels: ["feature:ready"] })],
        runs: [factoryRun({ id: 1, issue: 4, status: "in_progress", conclusion: null })],
      }),
    );

    const res = await postRun(app, { issue: 4 });

    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("running");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("refuses an issue that already has a queued run", async () => {
    const { app } = makeApp(
      collected({
        issues: [issueRecord({ number: 4, labels: ["feature:ready"] })],
        runs: [factoryRun({ id: 1, issue: 4, status: "queued", conclusion: null })],
      }),
    );

    expect((await postRun(app, { issue: 4 })).status).toBe(409);
  });

  it("refuses an open issue with no ready or triage label", async () => {
    const { app, dispatch } = makeApp(
      collected({ issues: [issueRecord({ number: 5, labels: ["feature:blocked"] })] }),
    );

    const res = await postRun(app, { issue: 5 });

    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("no ready or triage label");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("answers 409 demo mode in the demo", async () => {
    const { app } = makeApp(collected({}), { demo: true });

    const res = await postRun(app, { issue: 1 });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "demo mode" });
  });

  it("answers 400 for a body that is not an issue number", async () => {
    const { app } = makeApp(collected({}));

    expect((await postRun(app, { issue: "x" })).status).toBe(400);
    expect((await postRun(app, {})).status).toBe(400);
  });

  it("answers 502 with gh's message when the dispatch fails", async () => {
    const { app } = makeApp(
      collected({ issues: [issueRecord({ number: 6, labels: ["bug:ready"] })] }),
      {
        dispatch: async () => {
          throw new GhError(["workflow", "run"], "HTTP 403: Resource not accessible");
        },
      },
    );

    const res = await postRun(app, { issue: 6 });

    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain("Resource not accessible");
  });
});

describe("POST /api/opencode", () => {
  it("answers the one-time link opencode pair gave", async () => {
    const res = await makeApp(collected({})).app.request("/api/opencode", { ...POST });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      url: "http://127.0.0.1:4096/auth/connect/AbC123",
      expiresInMinutes: 5,
    });
  });

  it("answers 503 with the reason when opencode is not on PATH", async () => {
    const { app } = makeApp(collected({}), {
      opencode: fakeCli(async () => {
        throw new OpencodeUnavailable("opencode is not on PATH");
      }),
    });

    const res = await app.request("/api/opencode", { ...POST });

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "opencode is not on PATH" });
  });

  it("answers 409 demo mode in the demo", async () => {
    const res = await makeApp(collected({}), { demo: true }).app.request("/api/opencode", {
      ...POST,
    });

    expect(res.status).toBe(409);
  });
});

describe("the page", () => {
  function dist(): string {
    const dir = mkdtempSync(join(tmpdir(), "console-dist-"));
    temp.push(dir);
    mkdirSync(join(dir, "assets"));
    writeFileSync(join(dir, "index.html"), "<!doctype html><title>page</title>");
    writeFileSync(join(dir, "assets", "app.js"), "console.log(1)");
    writeFileSync(join(dir, "secret.txt"), "no");
    return dir;
  }

  it("serves index.html for a path with no extension, so a reload keeps the tab", async () => {
    const root = dist();
    const { app } = makeApp(collected({}), { distDir: root });

    for (const path of [
      "/",
      "/pipeline",
      "/pipeline/42",
      "/stats",
      "/automations",
      "/automations/booth-health.yml",
      "/opencode",
    ]) {
      const res = await get(app, path);
      expect(res.status, path).toBe(200);
      expect(await res.text()).toContain("<title>page</title>");
    }
  });

  it("serves an asset with its type and answers 404 for a missing one", async () => {
    const root = dist();
    const { app } = makeApp(collected({}), { distDir: root });

    const found = await get(app, "/assets/app.js");
    expect(found.headers.get("content-type")).toContain("javascript");
    expect((await get(app, "/assets/missing.js")).status).toBe(404);
  });

  it("does not serve a file outside the build", async () => {
    const root = dist();
    const inner = join(root, "assets");
    const { app } = makeApp(collected({}), { distDir: inner });

    expect((await get(app, "/%2e%2e/secret.txt")).status).toBe(404);
    expect((await get(app, "/../secret.txt")).status).toBe(404);
  });

  it("says the page is not built when there is no index.html", async () => {
    const res = await get(makeApp(collected({})).app, "/pipeline");

    expect(res.status).toBe(503);
  });
});

describe("a GitHub failure", () => {
  it("still yields a snapshot with github unavailable and the OpenCode half filled", async () => {
    const dir = mkdtempSync(join(tmpdir(), "console-gh-"));
    temp.push(dir);
    const path = join(dir, "opencode.db");
    const db = new DatabaseSync(path);
    db.exec(
      "CREATE TABLE session_v2 (id TEXT, parent_id TEXT, agent TEXT, directory TEXT, time_created INTEGER, time_updated INTEGER, title TEXT)",
    );
    db.exec("CREATE TABLE session_message (session_id TEXT, type TEXT, seq INTEGER, data TEXT)");
    const add = db.prepare("INSERT INTO session_v2 VALUES (?, ?, ?, '/repo', ?, ?, ?)");
    add.run("r1", null, "factory", NOW - 600_000, NOW - 100_000, "factory deliver #7 (attempt 1)");
    add.run("s1", "r1", "implementer", NOW - 500_000, NOW - 300_000, "Implement");
    add.run("c1", null, "build", NOW - 900_000, NOW - 800_000, "Chat about the app");
    db.close();

    const gh: GhRunner = async () => {
      throw new GhError(
        ["repo", "view"],
        "gh: To get started with GitHub CLI, please run: gh auth login",
      );
    };
    const collector = createCollector({
      now: () => NOW,
      gh,
      repo: undefined,
      db: openOpencodeDb(path),
      runLogDirs: () => [],
    });
    const { app } = makeApp(collected({}), { collector });

    const res = await get(app, "/api/snapshot?window=all");

    expect(res.status).toBe(200);
    const snapshot = Snapshot.parse(await res.json());
    const github = snapshot.sources.find((s) => s.name === "github");
    expect(github?.status).toBe("unavailable");
    expect(github?.reason).toContain("gh auth login");
    expect(snapshot.sources.find((s) => s.name === "opencode")?.status).toBe("ok");
    expect(snapshot.deliveries.map((d) => d.issue)).toEqual([7]);
    expect(snapshot.deliveries[0]?.phases.map((p) => p.phase)).toEqual(["Factory", "Implement"]);
    expect(snapshot.interactive.map((s) => s.title)).toEqual(["Chat about the app"]);
  });

  it("shares one refresh between concurrent requests and keeps it for 10 seconds", async () => {
    let clock = NOW;
    let reads = 0;
    const gh: GhRunner = async () => {
      reads += 1;
      throw new GhError(["repo", "view"], "down");
    };
    const dir = mkdtempSync(join(tmpdir(), "console-ttl-"));
    temp.push(dir);
    const collector = createCollector({
      now: () => clock,
      gh,
      repo: undefined,
      db: openOpencodeDb(join(dir, "none.db")),
      runLogDirs: () => [],
    });

    await Promise.all([collector.collect(), collector.collect(), collector.collect()]);
    clock += 9_000;
    await collector.collect();
    expect(reads).toBe(1);
    clock += 2_000;
    await collector.collect();
    expect(reads).toBe(2);
  });
});

describe("ghRunner", () => {
  it("reports a missing gh binary as a GhError, never through a shell", async () => {
    const saved = process.env["PATH"];
    process.env["PATH"] = "/nonexistent";
    try {
      await expect(ghRunner(process.cwd())(["--version"])).rejects.toThrow(/gh is not on PATH/);
    } finally {
      process.env["PATH"] = saved;
    }
  });
});
