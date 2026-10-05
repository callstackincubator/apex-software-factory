import { describe, expect, it } from "vitest";
import type { PrRecord } from "../github.ts";
import type { RunRecord } from "../opencode-db.ts";
import { collected, factoryRun, issueRecord, NOW } from "../test-support.ts";
import { buildDeliveries, buildDetail, buildSnapshot } from "./deliveries.ts";

const M = 60_000;
const REPORT = `PR: #5  Round: 1  Kind: code
Spec review: 1 findings (0 blocking)  Code review: 2 findings (1 blocking)
Fix: a.ts:1 broken
Nits: none
Rejected: none
Spec needs: none
Rerun: code`;

function dbRun(over: Partial<RunRecord> & { issue: number }): RunRecord {
  return {
    id: `run-${over.issue}-${over.attempt ?? 1}`,
    mode: "deliver",
    attempt: 1,
    start: NOW - 60 * M,
    end: NOW - 30 * M,
    outcome: null,
    costUsd: null,
    tokens: null,
    subagents: [],
    ...over,
  };
}

function withDb(c: ReturnType<typeof collected>, runs: RunRecord[]) {
  c.opencode = {
    source: { name: "opencode", status: "ok", refreshedAt: NOW },
    data: { runs, interactive: [] },
  };
  return c;
}

const pr = (over: Partial<PrRecord>): PrRecord => ({
  number: 5,
  url: "https://github.com/o/r/pull/5",
  state: "open",
  isDraft: false,
  merged: false,
  mergedAt: null,
  labels: [],
  head: "feature/5",
  body: "",
  ...over,
});

describe("buildDeliveries", () => {
  it("adds the phases of every attempt of an issue and shows each attempt on its own", () => {
    const c = withDb(
      collected({ issues: [issueRecord({ number: 5, labels: ["feature:blocked"] })] }),
      [
        dbRun({
          issue: 5,
          attempt: 1,
          start: NOW - 120 * M,
          end: NOW - 100 * M,
          subagents: [
            { id: "a", agent: "implementer", start: NOW - 118 * M, end: NOW - 105 * M, text: null },
          ],
        }),
        dbRun({
          issue: 5,
          attempt: 2,
          start: NOW - 90 * M,
          end: NOW - 60 * M,
          subagents: [
            { id: "b", agent: "implementer", start: NOW - 88 * M, end: NOW - 70 * M, text: null },
          ],
        }),
      ],
    );

    const [delivery] = buildDeliveries(c);

    expect(
      delivery?.attempts.map((a) => a.phases.find((p) => p.phase === "Implement")?.ms),
    ).toEqual([13 * M, 18 * M]);
    expect(delivery?.summary.phases.find((p) => p.phase === "Implement")?.ms).toBe(31 * M);
    expect(delivery?.summary.totalMs).toBe(50 * M);
  });

  it("numbers the review rounds by the run's review-verifier sessions in order, with their reports", () => {
    const verifier = (id: string, at: number, text: string | null) => ({
      id,
      agent: "review-verifier",
      start: NOW - at * M,
      end: NOW - (at - 2) * M,
      text,
    });
    const c = withDb(
      collected({ issues: [issueRecord({ number: 5, labels: ["feature:ready"] })] }),
      [
        dbRun({
          issue: 5,
          subagents: [verifier("v2", 40, "I could not finish."), verifier("v1", 50, REPORT)],
        }),
      ],
    );

    const detail = buildDetail(c, 5);

    expect(detail?.rounds.map((r) => [r.round, r.sessionId, r.report?.pr ?? null])).toEqual([
      [1, "v1", 5],
      [2, "v2", null],
    ]);
    expect(detail?.delivery.findings).toMatchObject({ rounds: 2, raised: 3, confirmed: 1 });
  });

  it("fills raised and confirmed from a merged PR's Review section when the database has no report", () => {
    const merged = pr({
      merged: true,
      mergedAt: NOW - 10 * M,
      body: "## Review\n\nSpec review: 2 findings, 1 fixed. Code review: 3 findings, 3 fixed.\n\nRejected:\n\n- x — not valid",
    });
    const c = collected({
      issues: [issueRecord({ number: 5, open: false, closedAt: NOW - 10 * M, pr: merged })],
      runs: [factoryRun({ id: 1, issue: 5 })],
    });

    const [delivery] = buildDeliveries(c);

    expect(delivery?.summary.state).toBe("merged");
    expect(delivery?.summary.findings).toMatchObject({
      fromPr: true,
      raised: 5,
      confirmed: 4,
      rejected: 1,
    });
  });

  it("reads the Status line and Assumption lines of the PR body", () => {
    const c = collected({
      issues: [
        issueRecord({
          number: 5,
          labels: ["feature:ready"],
          pr: pr({
            body: "### Status\n\nImplement: done  Gate: pending\n\n## Assumptions\n\n- Assumption: five moods\n",
          }),
        }),
      ],
    });

    const detail = buildDetail(c, 5);

    expect(detail?.delivery.statusLine).toEqual([
      { key: "Implement", value: "done" },
      { key: "Gate", value: "pending" },
    ]);
    expect(detail?.assumptions).toEqual(["five moods"]);
  });

  it("gives a running delivery its elapsed time and its current phase from the newest subagent", () => {
    const c = withDb(
      collected({
        issues: [issueRecord({ number: 5, labels: ["feature:ready"] })],
        runs: [
          factoryRun({
            id: 9,
            issue: 5,
            status: "in_progress",
            conclusion: null,
            startedAt: NOW - 25 * M,
          }),
        ],
      }),
      [
        dbRun({
          issue: 5,
          start: NOW - 25 * M,
          end: NOW - 20_000,
          subagents: [
            { id: "i", agent: "implementer", start: NOW - 24 * M, end: NOW - 10 * M, text: null },
            { id: "c", agent: "code-reviewer", start: NOW - 9 * M, end: NOW - 20_000, text: null },
          ],
        }),
      ],
    );

    const [delivery] = buildDeliveries(c);

    expect(delivery?.summary).toMatchObject({
      state: "running",
      currentPhase: "Review",
      elapsedMs: 25 * M,
    });
    expect(delivery?.attempts[0]?.live).toBe(true);
  });

  it("calls a run live without GitHub only while a session was written in the last 2 minutes", () => {
    const base = collected({});
    base.github = {
      source: { name: "github", status: "unavailable", reason: "down", refreshedAt: NOW },
      data: null,
    };
    const fresh = withDb(base, [
      dbRun({ issue: 7, start: NOW - 20 * M, end: NOW - 60_000 }),
      dbRun({ issue: 8, start: NOW - 20 * M, end: NOW - 5 * M }),
    ]);

    const states = Object.fromEntries(
      buildDeliveries(fresh).map((d) => [d.summary.issue, d.summary.state]),
    );

    expect(states).toEqual({ 7: "running", 8: "closed" });
  });

  it("lists a closed issue only when a factory run touched it", () => {
    const closed = (n: number) => issueRecord({ number: n, open: false, closedAt: NOW - M });
    const c = collected({
      issues: [closed(1), closed(2)],
      runs: [factoryRun({ id: 1, issue: 2 })],
    });

    expect(buildDeliveries(c).map((d) => d.summary.issue)).toEqual([2]);
  });

  it("orders deliveries by newest activity first", () => {
    const c = collected({
      issues: [
        issueRecord({ number: 1, labels: ["bug:ready"], createdAt: NOW - 5 * M }),
        issueRecord({ number: 2, labels: ["bug:ready"], createdAt: NOW - M }),
      ],
    });

    expect(buildDeliveries(c).map((d) => d.summary.issue)).toEqual([2, 1]);
  });
});

describe("buildSnapshot workers and queue", () => {
  const running = factoryRun({
    id: 9,
    issue: 5,
    status: "in_progress",
    conclusion: null,
    startedAt: NOW - 12 * M,
    runnerName: "booth-factory-1",
  });
  const queued = (id: number, issue: number, ago: number) =>
    factoryRun({
      id,
      issue,
      status: "queued",
      conclusion: null,
      createdAt: NOW - ago,
      startedAt: null,
      runnerName: null,
    });

  it("shows each factory runner as idle or busy with the issue it holds", () => {
    const c = collected({
      issues: [issueRecord({ number: 5, title: "Pull to refresh", labels: ["feature:ready"] })],
      runs: [running],
      runners: [
        { name: "booth-factory-1", online: true },
        { name: "booth-factory-2", online: true },
      ],
    });

    const { workers } = buildSnapshot(c, "7d", { available: false });

    expect(workers).toMatchObject([
      {
        name: "booth-factory-1",
        busy: true,
        issue: 5,
        title: "Pull to refresh",
        elapsedMs: 12 * M,
      },
      { name: "booth-factory-2", busy: false, issue: null },
    ]);
  });

  it("lists queued runs oldest first with their wait", () => {
    const c = collected({ issues: [], runs: [queued(2, 8, 2 * M), queued(3, 9, 7 * M)] });

    const { queue } = buildSnapshot(c, "7d", { available: false });

    expect(queue.map((q) => [q.issue, q.waitingMs])).toEqual([
      [9, 7 * M],
      [8, 2 * M],
    ]);
  });

  it("builds the workers from the jobs alone, and says so, when the runner list is denied", () => {
    const c = collected({ issues: [], runs: [running], runners: null });

    const snapshot = buildSnapshot(c, "7d", { available: false });

    expect(snapshot.workersNote).toBe("runner list needs admin access");
    expect(snapshot.workers).toMatchObject([{ name: "booth-factory-1", busy: true, issue: 5 }]);
  });
});
