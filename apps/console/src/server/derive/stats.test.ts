import { describe, expect, it } from "vitest";
import type { Delivery } from "../../shared/schema.ts";
import { NO_FINDINGS } from "./findings.ts";
import { computeStats, median, stopKind, windowStart, type StatRun } from "./stats.ts";

const M = 60_000;
const DAY = 24 * 60 * M;
const now = new Date(2026, 9, 7, 15, 0, 0).getTime();

const run = (
  issue: number,
  ago: number,
  lengthMin: number,
  phases: [string, number][],
  live = false,
): StatRun => ({
  issue,
  start: now - ago,
  end: now - ago + lengthMin * M,
  live,
  phases: phases.map(([phase, min]) => ({ phase, ms: min * M })),
  costUsd: 1,
  tokens: { input: 10, output: 2, reasoning: 1 },
});

const delivery = (issue: number, state: Delivery["state"]): Delivery => ({
  issue,
  title: `#${issue}`,
  kind: "feature",
  state,
  labels: [],
  open: true,
  issueUrl: null,
  pr: null,
  statusLine: [],
  currentPhase: null,
  elapsedMs: null,
  runStartedAt: null,
  lastActivityAt: now,
  runs: 1,
  phases: [],
  totalMs: 0,
  findings: NO_FINDINGS,
  canStart: false,
});

describe("median", () => {
  it("takes the middle value, or the mean of the two middle ones", () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1, 2, 3, 10])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe("windowStart", () => {
  it("is local midnight for today, seven days back for 7d, and zero for all", () => {
    expect(new Date(windowStart("today", now)).getHours()).toBe(0);
    expect(windowStart("today", now)).toBeLessThanOrEqual(now);
    expect(windowStart("today", now)).toBeGreaterThan(now - DAY);
    expect(windowStart("7d", now)).toBe(now - 7 * DAY);
    expect(windowStart("all", now)).toBe(0);
  });
});

describe("stopKind", () => {
  it("names a stall, a timeout, a provider error and a garbled turn from the reason", () => {
    expect(stopKind("no progress for 15 min")).toBe("stall");
    expect(stopKind("hard timeout (80 min for the run)")).toBe("timeout");
    expect(stopKind("the agent's turn ended on an error (ServiceUnavailable)")).toBe(
      "provider error",
    );
    expect(stopKind("the agent's last turn came back garbled (finish length, 0 text parts)")).toBe(
      "garbled turn",
    );
  });

  it("falls back to the first three words of a reason it does not know", () => {
    expect(stopKind("disk is full again today")).toBe("disk is full");
  });
});

describe("computeStats", () => {
  const runs = [
    run(1, 2 * DAY, 40, [
      ["Implement", 20],
      ["Review", 10],
    ]),
    run(2, 3 * 60 * M, 60, [
      ["Implement", 30],
      ["Review", 6],
    ]),
    run(3, 20 * DAY, 10, [["Implement", 8]]),
    run(4, 10 * M, 5, [["Implement", 1]], true),
  ];
  const deliveries = [
    delivery(1, "merged"),
    delivery(2, "failed"),
    delivery(3, "merged"),
    delivery(4, "running"),
  ];

  const stats = (window: "today" | "7d" | "all") =>
    computeStats({ window, now, runs, deliveries, stops: [] });

  it("counts a run by its start time inside the window", () => {
    expect(stats("today").runs).toBe(2);
    expect(stats("7d").runs).toBe(3);
    expect(stats("all").runs).toBe(4);
  });

  it("counts deliveries by state for the issues that had a run in the window", () => {
    expect(stats("7d")).toMatchObject({ merged: 1, failed: 1, parked: 0, blocked: 0 });
    expect(stats("all").merged).toBe(2);
  });

  it("takes the median and longest per phase over finished runs only", () => {
    const implement = stats("all").phases.find((p) => p.phase === "Implement");

    // 20, 30 and 8 minutes; the live run's 1 minute is left out.
    expect(implement).toMatchObject({ runs: 3, medianMs: 20 * M, maxMs: 30 * M });
  });

  it("sums cost and tokens of the runs in the window", () => {
    expect(stats("7d")).toMatchObject({
      costUsd: 3,
      tokens: { input: 30, output: 6, reasoning: 3 },
    });
  });

  it("reports no cost when no run has one", () => {
    const bare = computeStats({
      window: "all",
      now,
      runs: runs.map((r) => ({ ...r, costUsd: null, tokens: null })),
      deliveries,
      stops: [],
    });

    expect(bare.costUsd).toBeNull();
    expect(bare.tokens).toBeNull();
  });

  it("counts watchdog stops in the window, newest first, grouped by kind", () => {
    const s = computeStats({
      window: "7d",
      now,
      runs,
      deliveries,
      stops: [
        { at: now - 2 * DAY, issue: 1, attempt: 1, reason: "no progress for 15 min" },
        { at: now - 1 * DAY, issue: 2, attempt: 1, reason: "no progress for 15 min" },
        { at: now - 30 * DAY, issue: 3, attempt: 1, reason: "hard timeout (80 min for the run)" },
      ],
    });

    expect(s.watchdogStops).toBe(2);
    expect(s.watchdog.map((w) => w.issue)).toEqual([2, 1]);
    expect(s.watchdogReasons).toEqual([{ reason: "stall", count: 2 }]);
  });
});
