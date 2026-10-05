import { describe, expect, it } from "vitest";
import type { AutomationsRead, WorkflowFile, WorkflowRun } from "../workflows.ts";
import { buildAutomationDetail, buildAutomations, dispatchRefusal } from "./automations.ts";

const NOW = Date.UTC(2026, 9, 7, 12, 0, 0);
const M = 60_000;

const file = (over: Partial<WorkflowFile> & { file: string }): WorkflowFile => ({
  name: over.file,
  description: "",
  events: ["push"],
  crons: [],
  inputs: [],
  runsOn: ["ubuntu-24.04"],
  selfHosted: false,
  ...over,
});

const run = (
  id: number,
  ago: number,
  conclusion: string | null,
  over: Partial<WorkflowRun> = {},
): WorkflowRun => ({
  id,
  event: "schedule",
  status: conclusion === null ? "in_progress" : "completed",
  conclusion,
  startedAt: NOW - ago,
  updatedAt: NOW - ago + 2 * M,
  url: `u${id}`,
  ...over,
});

function read(
  files: WorkflowFile[],
  runs: Record<string, WorkflowRun[]>,
  states: Record<string, string> = {},
): AutomationsRead {
  return {
    now: NOW,
    repo: "o/r",
    files,
    states: new Map(files.map((f) => [f.file, states[f.file] ?? "active"])),
    runs: new Map(Object.entries(runs)),
    notes: [],
  };
}

describe("buildAutomations", () => {
  it("lists scheduled workflows first by next run, then the rest by name", () => {
    const result = buildAutomations(
      read(
        [
          file({ file: "z.yml", name: "Zeta" }),
          file({ file: "late.yml", name: "Late", crons: ["0 20 * * *"] }),
          file({ file: "soon.yml", name: "Soon", crons: ["30 12 * * *"] }),
          file({ file: "a.yml", name: "Alpha" }),
        ],
        {},
      ),
    );

    expect(result.automations.map((a) => a.name)).toEqual(["Soon", "Late", "Alpha", "Zeta"]);
  });

  it("takes the earliest next run over a workflow's crons and says the schedule in words", () => {
    const [a] = buildAutomations(
      read([file({ file: "x.yml", crons: ["0 20 * * *", "30 12 * * *"] })], {}),
    ).automations;

    expect(new Date(a?.nextRun ?? 0).toISOString()).toBe("2026-10-07T12:30:00.000Z");
    expect(a?.schedule).toEqual([
      { cron: "0 20 * * *", words: "every day at 20:00 UTC" },
      { cron: "30 12 * * *", words: "every day at 12:30 UTC" },
    ]);
  });

  it("gives a disabled workflow no next run and the status disabled", () => {
    const [a] = buildAutomations(
      read([file({ file: "x.yml", crons: ["0 20 * * *"] })], {}, { "x.yml": "disabled_manually" }),
    ).automations;

    expect(a).toMatchObject({ nextRun: null, status: "disabled", state: "disabled_manually" });
  });

  it("is failing when its last completed run failed, healthy when it succeeded", () => {
    const result = buildAutomations(
      read([file({ file: "bad.yml" }), file({ file: "good.yml" })], {
        "bad.yml": [run(1, 10 * M, "failure"), run(2, 60 * M, "success")],
        "good.yml": [run(3, 10 * M, "success"), run(4, 60 * M, "failure")],
      }),
    );

    expect(Object.fromEntries(result.automations.map((a) => [a.file, a.status]))).toEqual({
      "bad.yml": "failing",
      "good.yml": "healthy",
    });
  });

  it("does not let a run in progress hide the last completed one", () => {
    const [a] = buildAutomations(
      read([file({ file: "x.yml" })], { "x.yml": [run(1, M, null), run(2, 90 * M, "failure")] }),
    ).automations;

    expect(a?.status).toBe("failing");
    expect(a?.lastRun?.word).toBe("in_progress");
  });

  it("counts success over completed runs, skipping skipped and cancelled, and takes the median duration", () => {
    const [a] = buildAutomations(
      read([file({ file: "x.yml" })], {
        "x.yml": [
          run(1, 10 * M, "success", { updatedAt: NOW - 10 * M + 1 * M }),
          run(2, 20 * M, "success", { updatedAt: NOW - 20 * M + 3 * M }),
          run(3, 30 * M, "failure", { updatedAt: NOW - 30 * M + 5 * M }),
          run(4, 40 * M, "skipped"),
          run(5, 50 * M, "cancelled"),
          run(6, 60 * M, null),
        ],
      }),
    ).automations;

    expect(a?.successRate).toBeCloseTo(2 / 3);
    // 1, 3, 5, 2 (skipped), 2 (cancelled) minutes among the finished: median 2.
    expect(a?.medianMs).toBe(2 * M);
  });

  it("has no success rate without a completed run", () => {
    const [a] = buildAutomations(read([file({ file: "x.yml" })], {})).automations;

    expect(a).toMatchObject({ successRate: null, medianMs: null, lastRun: null });
  });

  it("calls a scheduled time that passed with no scheduled run since it due", () => {
    // 17 * * * * fired at 11:17; the last scheduled run began at 10:17.
    const [due] = buildAutomations(
      read([file({ file: "x.yml", crons: ["17 * * * *"] })], {
        "x.yml": [run(1, 103 * M, "success")],
      }),
    ).automations;
    const [ontime] = buildAutomations(
      read([file({ file: "x.yml", crons: ["17 * * * *"] })], {
        "x.yml": [run(1, 43 * M, "success")],
      }),
    ).automations;

    expect(due?.dueSince).toBe(Date.UTC(2026, 9, 7, 11, 17));
    expect(ontime?.dueSince).toBeNull();
  });
});

describe("dispatchRefusal", () => {
  it("allows a workflow with workflow_dispatch and no required input", () => {
    expect(
      dispatchRefusal(file({ file: "x.yml", events: ["workflow_dispatch"] }), "active"),
    ).toBeNull();
  });

  it("refuses one with a required input, naming it", () => {
    const wf = file({
      file: "x.yml",
      events: ["workflow_dispatch"],
      inputs: [{ name: "issue", required: true, description: "" }],
    });

    expect(dispatchRefusal(wf, "active")).toContain("issue");
  });

  it("refuses one without workflow_dispatch, a disabled one, and factory.yml", () => {
    expect(dispatchRefusal(file({ file: "x.yml" }), "active")).toContain("workflow_dispatch");
    expect(
      dispatchRefusal(file({ file: "x.yml", events: ["workflow_dispatch"] }), "disabled_manually"),
    ).toContain("disabled");
    expect(
      dispatchRefusal(file({ file: "factory.yml", events: ["workflow_dispatch"] }), "active"),
    ).toContain("Pipeline");
  });
});

describe("buildAutomationDetail", () => {
  it("gives at most 20 runs, newest first, with their words and durations", () => {
    const runs = Array.from({ length: 25 }, (_, i) => run(i + 1, (i + 1) * 10 * M, "success"));

    const detail = buildAutomationDetail(
      read([file({ file: "x.yml" })], { "x.yml": runs }),
      "x.yml",
    );

    expect(detail?.runs).toHaveLength(20);
    expect(detail?.runs[0]).toMatchObject({ id: 1, word: "success", durationMs: 2 * M });
  });

  it("answers null for a file that is not a workflow", () => {
    expect(buildAutomationDetail(read([], {}), "nope.yml")).toBeNull();
  });
});
