import { describe, expect, it, vi } from "vitest";
import { AutomationDetail, AutomationsResponse } from "../shared/schema.ts";
import { createApp } from "./app.ts";
import { demoAutomations, demoChat, demoCollector } from "./demo.ts";
import type { GhRunner } from "./github.ts";
import { NOW } from "./test-support.ts";
import { dispatchWorkflow, type AutomationsRead, type WorkflowFile } from "./workflows.ts";

const PORT = 4280;
const headers = { host: `127.0.0.1:${PORT}`, origin: `http://127.0.0.1:${PORT}` };

const wf = (over: Partial<WorkflowFile> & { file: string }): WorkflowFile => ({
  name: over.file,
  description: "",
  events: ["workflow_dispatch"],
  crons: [],
  inputs: [],
  runsOn: ["ubuntu-24.04"],
  selfHosted: false,
  ...over,
});

function makeApp(files: WorkflowFile[], over: { demo?: boolean; gh?: GhRunner } = {}) {
  const read: AutomationsRead = {
    now: NOW,
    repo: "o/r",
    files,
    states: new Map(files.map((f) => [f.file, "active"])),
    runs: new Map(),
    notes: [],
  };
  const dispatch = vi.fn(async () => {});
  const app = createApp({
    port: PORT,
    demo: over.demo ?? false,
    distDir: "/nonexistent",
    collector: demoCollector(() => NOW),
    automations: { collect: async () => read },
    opencode: {
      info: async () => ({ available: false }),
      pair: async () => ({ url: "", expiresInMinutes: 5 }),
    },
    chat: demoChat(),
    dispatch: async () => {},
    dispatchWorkflow: over.gh
      ? (repo, file) => dispatchWorkflow(over.gh as GhRunner, repo, file)
      : dispatch,
  });
  return { app, dispatch };
}

const post = (app: ReturnType<typeof makeApp>["app"], file: string) =>
  app.request(`/api/automations/${file}/dispatch`, { method: "POST", headers });

describe("GET /api/automations", () => {
  it("validates against the schema, one entry per workflow file", async () => {
    const { app } = makeApp([wf({ file: "a.yml" }), wf({ file: "b.yml", crons: ["0 6 * * *"] })]);

    const body = AutomationsResponse.parse(
      await (await app.request("/api/automations", { headers })).json(),
    );

    expect(body.automations.map((a) => a.file)).toEqual(["b.yml", "a.yml"]);
  });

  it("serves the demo's real workflows and the two invented ones, with a failing one", async () => {
    const dir = new URL("../../../../.github/workflows", import.meta.url).pathname;
    const app = createApp({
      port: PORT,
      demo: true,
      distDir: "/nonexistent",
      collector: demoCollector(() => NOW),
      automations: demoAutomations(dir, () => NOW),
      opencode: {
        info: async () => ({ available: false }),
        pair: async () => ({ url: "", expiresInMinutes: 5 }),
      },
      chat: demoChat(),
      dispatch: async () => {},
      dispatchWorkflow: async () => {},
    });

    const body = AutomationsResponse.parse(
      await (await app.request("/api/automations", { headers })).json(),
    );
    const names = body.automations.map((a) => a.file);

    expect(names).toEqual(
      expect.arrayContaining([
        "ci.yml",
        "factory.yml",
        "issue-state.yml",
        "labels.yml",
        "ota-publish.yml",
        "stale-claims.yml",
        "booth-health.yml",
      ]),
    );
    expect(body.automations.find((a) => a.file === "booth-health.yml")?.status).toBe("failing");
    expect(body.automations.slice(0, 3).every((a) => a.crons.length > 0)).toBe(true);
    for (const a of body.automations) {
      const res = await app.request(`/api/automations/${a.file}`, { headers });
      expect(AutomationDetail.parse(await res.json()).automation.file).toBe(a.file);
    }
  });
});

describe("GET /api/automations/:file", () => {
  it("answers 404 for a file that is not a workflow", async () => {
    const { app } = makeApp([wf({ file: "a.yml" })]);

    expect((await app.request("/api/automations/nope.yml", { headers })).status).toBe(404);
  });
});

describe("POST /api/automations/:file/dispatch", () => {
  it("dispatches with the exact gh arguments, on the default branch, and answers 202", async () => {
    const calls: string[][] = [];
    const gh: GhRunner = async (args) => {
      calls.push([...args]);
      return args[0] === "api" ? "main\n" : "";
    };
    const { app } = makeApp([wf({ file: "labels.yml" })], { gh });

    const res = await post(app, "labels.yml");

    expect(res.status).toBe(202);
    expect(calls).toEqual([
      ["api", "repos/o/r", "-q", ".default_branch"],
      ["workflow", "run", "labels.yml", "--repo", "o/r", "--ref", "main"],
    ]);
  });

  it("refuses a workflow with a required input with 409 and dispatches nothing", async () => {
    const { app, dispatch } = makeApp([
      wf({ file: "x.yml", inputs: [{ name: "version", required: true, description: "" }] }),
    ]);

    const res = await post(app, "x.yml");

    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("version");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("never dispatches factory.yml from here", async () => {
    const { app, dispatch } = makeApp([
      wf({ file: "factory.yml", inputs: [{ name: "issue", required: true, description: "" }] }),
    ]);

    const res = await post(app, "factory.yml");

    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("Pipeline");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("refuses a workflow with no workflow_dispatch", async () => {
    const { app } = makeApp([wf({ file: "p.yml", events: ["push"] })]);

    expect((await post(app, "p.yml")).status).toBe(409);
  });

  it("answers 404 for an unknown file, 409 demo mode in the demo, and 403 without the Origin", async () => {
    const { app } = makeApp([wf({ file: "a.yml" })]);
    expect((await post(app, "nope.yml")).status).toBe(404);
    const demo = makeApp([wf({ file: "a.yml" })], { demo: true });
    expect((await post(demo.app, "a.yml")).status).toBe(409);
    const res = await app.request("/api/automations/a.yml/dispatch", {
      method: "POST",
      headers: { host: headers.host },
    });
    expect(res.status).toBe(403);
  });
});
