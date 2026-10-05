import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  dispatchRun,
  GhError,
  newGithubCache,
  parseIssues,
  readGithub,
  type GhRunner,
} from "./github.ts";
import { discoverRunLogDirs, readStops } from "./run-logs.ts";

const NOW = Date.parse("2026-10-07T12:00:00Z");

function stub(routes: Record<string, string | Error>): { gh: GhRunner; calls: string[][] } {
  const calls: string[][] = [];
  const gh: GhRunner = async (args) => {
    calls.push([...args]);
    const key =
      args[0] === "api" && args[1] !== "graphql" ? `api ${args[1]}` : args.slice(0, 2).join(" ");
    const hit = Object.entries(routes).find(([k]) => key.startsWith(k));
    if (!hit) throw new GhError(args, `HTTP 404: no stub for ${key}`);
    if (hit[1] instanceof Error) throw hit[1];
    return hit[1];
  };
  return { gh, calls };
}

const graphql = (nodes: { open?: unknown[]; closed?: unknown[]; prs?: unknown[] }) =>
  JSON.stringify({
    data: {
      repository: {
        open: { nodes: nodes.open ?? [] },
        closed: { nodes: nodes.closed ?? [] },
        pullRequests: { nodes: nodes.prs ?? [] },
      },
    },
  });

const issueNode = (
  number: number,
  state: string,
  labels: string[],
  closedAt: string | null = null,
) => ({
  number,
  title: `Issue ${number}`,
  state,
  url: `https://github.com/o/r/issues/${number}`,
  createdAt: "2026-10-06T10:00:00Z",
  closedAt,
  labels: { nodes: labels.map((name) => ({ name })) },
});

describe("readGithub", () => {
  const runsJson = JSON.stringify({
    workflow_runs: [
      {
        id: 11,
        status: "in_progress",
        conclusion: null,
        created_at: "2026-10-07T11:00:00Z",
        updated_at: "2026-10-07T11:50:00Z",
        run_started_at: "2026-10-07T11:01:00Z",
        html_url: "u11",
      },
      {
        id: 12,
        status: "completed",
        conclusion: "failure",
        created_at: "2026-10-07T09:00:00Z",
        updated_at: "2026-10-07T09:40:00Z",
        html_url: "u12",
      },
    ],
  });
  const jobs = (name: string, runner: string) =>
    JSON.stringify({ jobs: [{ name, runner_name: runner, started_at: "2026-10-07T11:01:30Z" }] });

  it("gives the factory runners only, the runs with the issue from their job, and the issues", async () => {
    const { gh } = stub({
      "api repos/o/r/actions/runners": JSON.stringify({
        runners: [
          {
            name: "booth-factory-1",
            status: "online",
            labels: [{ name: "self-hosted" }, { name: "factory" }],
          },
          { name: "laptop", status: "online", labels: [{ name: "self-hosted" }] },
        ],
      }),
      "api repos/o/r/actions/workflows": runsJson,
      "api repos/o/r/actions/runs/11": jobs("#42", "booth-factory-1"),
      "api repos/o/r/actions/runs/12": jobs("#17", "booth-factory-2"),
      "api graphql": graphql({ open: [issueNode(42, "OPEN", ["feature:ready"])] }),
    });

    const read = await readGithub(gh, { repo: "o/r", now: NOW, cache: newGithubCache() });

    if (!read.ok) throw new Error(read.reason);
    expect(read.runners).toEqual([{ name: "booth-factory-1", online: true }]);
    expect(read.runs.map((r) => [r.id, r.issue, r.runnerName, r.status])).toEqual([
      [11, 42, "booth-factory-1", "in_progress"],
      [12, 17, "booth-factory-2", "completed"],
    ]);
    expect(read.issues.map((i) => [i.number, i.open, i.labels])).toEqual([
      [42, true, ["feature:ready"]],
    ]);
  });

  it("says the runner list needs admin access on 403 and builds on the jobs", async () => {
    const { gh } = stub({
      "api repos/o/r/actions/runners": new GhError(
        ["api"],
        "gh: Resource not accessible (HTTP 403)",
      ),
      "api repos/o/r/actions/workflows": runsJson,
      "api repos/o/r/actions/runs/11": jobs("#42", "booth-factory-1"),
      "api repos/o/r/actions/runs/12": jobs("#17", "booth-factory-2"),
      "api graphql": graphql({}),
    });

    const read = await readGithub(gh, { repo: "o/r", now: NOW, cache: newGithubCache() });

    if (!read.ok) throw new Error(read.reason);
    expect(read.runners).toBeNull();
    expect(read.runnersNote).toBe("runner list needs admin access");
  });

  it("reads a finished run's jobs once and keeps them for the next refresh", async () => {
    const { gh, calls } = stub({
      "api repos/o/r/actions/runners": JSON.stringify({ runners: [] }),
      "api repos/o/r/actions/workflows": runsJson,
      "api repos/o/r/actions/runs/11": jobs("#42", "booth-factory-1"),
      "api repos/o/r/actions/runs/12": jobs("#17", "booth-factory-2"),
      "api graphql": graphql({}),
    });
    const cache = newGithubCache();

    await readGithub(gh, { repo: "o/r", now: NOW, cache });
    await readGithub(gh, { repo: "o/r", now: NOW, cache });

    const jobCalls = (id: number) => calls.filter((c) => c[1]?.includes(`/runs/${id}/jobs`)).length;
    expect(jobCalls(12)).toBe(1);
    expect(jobCalls(11)).toBe(2);
  });

  it("is unavailable with gh's message when a read fails", async () => {
    const { gh } = stub({ "repo view": new GhError(["repo", "view"], "not logged in") });

    const read = await readGithub(gh, { repo: undefined, now: NOW, cache: newGithubCache() });

    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.reason).toContain("not logged in");
  });

  it("asks gh for the repository only when none is configured", async () => {
    const { gh, calls } = stub({
      "repo view": "callstack/apex\n",
      "api repos/callstack/apex/actions/runners": JSON.stringify({ runners: [] }),
      "api repos/callstack/apex/actions/workflows": JSON.stringify({ workflow_runs: [] }),
      "api graphql": graphql({}),
    });

    const read = await readGithub(gh, { repo: undefined, now: NOW, cache: newGithubCache() });

    expect(read.ok && read.repo).toBe("callstack/apex");
    expect(calls[0]).toEqual(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]);
  });
});

describe("parseIssues", () => {
  it("attaches the newest PR whose head is <kind>/<n> and ignores other branches", () => {
    const pr = (number: number, head: string, merged: boolean) => ({
      number,
      url: `u${number}`,
      state: merged ? "MERGED" : "OPEN",
      isDraft: false,
      merged,
      mergedAt: merged ? "2026-10-06T12:00:00Z" : null,
      headRefName: head,
      body: "### Status\n\nGate: merged",
      labels: { nodes: [{ name: "needs-simulator" }] },
    });
    const issues = parseIssues(
      JSON.parse(
        graphql({
          open: [issueNode(5, "OPEN", ["task:ready"])],
          prs: [pr(60, "task/5", false), pr(61, "task/5", true), pr(62, "claude/other", false)],
        }),
      ),
      NOW,
    );

    expect(issues[0]?.pr).toMatchObject({
      number: 60,
      head: "task/5",
      labels: ["needs-simulator"],
    });
  });

  it("drops an issue closed more than seven days ago", () => {
    const issues = parseIssues(
      JSON.parse(
        graphql({
          closed: [
            issueNode(1, "CLOSED", [], "2026-10-05T00:00:00Z"),
            issueNode(2, "CLOSED", [], "2026-09-20T00:00:00Z"),
          ],
        }),
      ),
      NOW,
    );

    expect(issues.map((i) => i.number)).toEqual([1]);
  });
});

describe("dispatchRun", () => {
  it("passes gh the workflow, the repository and the issue as separate arguments", async () => {
    const { gh, calls } = stub({ "workflow run": "" });

    await dispatchRun(gh, "o/r", 42);

    expect(calls).toEqual([["workflow", "run", "factory.yml", "--repo", "o/r", "-f", "issue=42"]]);
  });
});

describe("run logs", () => {
  it("reads each .stopped file as one stop with its reason, and ignores other files", () => {
    const dir = mkdtempSync(join(tmpdir(), "console-logs-"));
    try {
      writeFileSync(join(dir, "42-1-20261007-101500.log.stopped"), "no progress for 15 min\n");
      writeFileSync(
        join(dir, "42-2-20261007-112000.log.stopped"),
        "hard timeout (80 min for the run)\n",
      );
      writeFileSync(join(dir, "42-1-20261007-101500.log"), "a long log");
      utimesSync(join(dir, "42-1-20261007-101500.log.stopped"), 1_000, 1_000);

      const stops = readStops([dir, join(dir, "missing")]);

      expect(stops.map((s) => [s.issue, s.attempt, s.reason])).toEqual([
        [42, 2, "hard timeout (80 min for the run)"],
        [42, 1, "no progress for 15 min"],
      ]);
      expect(stops[1]?.at).toBe(1_000_000);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("finds the runner checkouts' run-log directories and the repository's own", () => {
    const home = mkdtempSync(join(tmpdir(), "console-home-"));
    const root = mkdtempSync(join(tmpdir(), "console-root-"));
    try {
      mkdirSync(join(home, "actions-runner-factory-1/_work/r/r/.worktrees/factory-runs"), {
        recursive: true,
      });
      mkdirSync(join(home, "actions-runner-factory-2/_work/r/r"), { recursive: true });
      mkdirSync(join(root, ".worktrees/factory-runs"), { recursive: true });

      expect(discoverRunLogDirs(home, root)).toEqual([
        join(home, "actions-runner-factory-1/_work/r/r/.worktrees/factory-runs"),
        join(root, ".worktrees/factory-runs"),
      ]);
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });
});
