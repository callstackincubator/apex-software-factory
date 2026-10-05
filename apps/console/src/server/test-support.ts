import type { Collected } from "./derive/deliveries.ts";
import type { FactoryRun, IssueRecord, SpecIssue, SpecsRead } from "./github.ts";

/** Small builders for tests: a reading of the three sources with only what a test names. */
export const NOW = Date.UTC(2026, 9, 7, 12, 0, 0);

export function issueRecord(over: Partial<IssueRecord> & { number: number }): IssueRecord {
  return {
    title: `Issue ${over.number}`,
    open: true,
    labels: [],
    url: `https://github.com/o/r/issues/${over.number}`,
    createdAt: NOW - 3_600_000,
    closedAt: null,
    pr: null,
    ...over,
  };
}

export function factoryRun(over: Partial<FactoryRun> & { id: number }): FactoryRun {
  return {
    issue: null,
    status: "completed",
    conclusion: "success",
    createdAt: NOW - 3_000_000,
    startedAt: NOW - 3_000_000,
    updatedAt: NOW - 2_000_000,
    runnerName: "booth-factory-1",
    url: `https://github.com/o/r/actions/runs/${over.id}`,
    ...over,
  };
}

export function collected(parts: {
  issues?: IssueRecord[];
  runs?: FactoryRun[];
  runners?: { name: string; online: boolean }[] | null;
  specs?: SpecsRead;
}): Collected {
  return {
    now: NOW,
    demo: false,
    repo: "o/r",
    github: {
      source: { name: "github", status: "ok", refreshedAt: NOW },
      data: {
        ok: true,
        repo: "o/r",
        runners:
          parts.runners === undefined ? [{ name: "booth-factory-1", online: true }] : parts.runners,
        runnersNote: parts.runners === null ? "runner list needs admin access" : null,
        runs: parts.runs ?? [],
        issues: parts.issues ?? [],
        specs: parts.specs ?? { waiting: [], features: [] },
      },
    },
    opencode: {
      source: {
        name: "opencode",
        status: "unavailable",
        reason: "not read in this test",
        refreshedAt: NOW,
      },
      data: null,
    },
    runLogs: { source: { name: "runLogs", status: "ok", refreshedAt: NOW }, stops: [] },
  };
}

export function specIssue(over: Partial<SpecIssue> & { number: number }): SpecIssue {
  return {
    title: `Spec ${over.number}`,
    url: `https://github.com/o/r/issues/${over.number}`,
    labels: [],
    body: "",
    createdAt: NOW - 7_200_000,
    updatedAt: NOW - 3_600_000,
    ...over,
  };
}
