import { describe, expect, it } from "vitest";
import { currentPhase, phaseOf, runPhases, sumPhases, unionSpans } from "./phases.ts";

const M = 60_000;

describe("phaseOf", () => {
  it("maps every factory agent to its phase and an unknown agent to its own name", () => {
    expect(
      [
        "implementer",
        "spec-reviewer",
        "code-reviewer",
        "review-verifier",
        "mobile-verifier",
        "ota-verifier",
        "triager",
        "spec-checker",
        "docs-writer",
      ].map(phaseOf),
    ).toEqual([
      "Implement",
      "Review",
      "Review",
      "Verify",
      "Simulator",
      "OTA check",
      "Triage",
      "Spec check",
      "docs-writer",
    ]);
  });
});

describe("runPhases", () => {
  const ms = (list: { phase: string; ms: number }[], phase: string) =>
    list.find((p) => p.phase === phase)?.ms;

  it("counts the overlap of the two parallel reviewers once", () => {
    const { phases } = runPhases({ start: 0, end: 20 * M }, [
      { agent: "spec-reviewer", start: 2 * M, end: 8 * M },
      { agent: "code-reviewer", start: 4 * M, end: 12 * M },
    ]);

    expect(ms(phases, "Review")).toBe(10 * M);
  });

  it("makes Factory the part of the run no subagent covers", () => {
    const { phases } = runPhases({ start: 0, end: 20 * M }, [
      { agent: "implementer", start: 2 * M, end: 10 * M },
      { agent: "code-reviewer", start: 12 * M, end: 16 * M },
    ]);

    // 0-2, 10-12 and 16-20.
    expect(ms(phases, "Factory")).toBe(8 * M);
    expect(ms(phases, "Implement")).toBe(8 * M);
  });

  it("orders phases by first start", () => {
    const { phases } = runPhases({ start: 0, end: 30 * M }, [
      { agent: "review-verifier", start: 20 * M, end: 24 * M },
      { agent: "implementer", start: 2 * M, end: 10 * M },
    ]);

    expect(phases.map((p) => p.phase)).toEqual(["Factory", "Implement", "Verify"]);
  });

  it("widens the run to hold a subagent that outlives it", () => {
    const run = runPhases({ start: 0, end: 10 * M }, [
      { agent: "implementer", start: 2 * M, end: 14 * M },
    ]);

    expect(run.end).toBe(14 * M);
    expect(ms(run.phases, "Factory")).toBe(2 * M);
  });

  it("gives a run with no subagents to Factory alone", () => {
    expect(runPhases({ start: 0, end: 5 * M }, []).phases).toEqual([
      { phase: "Factory", ms: 5 * M },
    ]);
  });

  it("puts the intervals in order of start with their phase", () => {
    const { intervals } = runPhases({ start: 0, end: 30 * M }, [
      { agent: "code-reviewer", start: 9 * M, end: 12 * M },
      { agent: "implementer", start: 1 * M, end: 8 * M },
    ]);

    expect(intervals.map((i) => [i.agent, i.phase])).toEqual([
      ["implementer", "Implement"],
      ["code-reviewer", "Review"],
    ]);
  });
});

describe("sumPhases", () => {
  it("adds the phases of all attempts of an issue", () => {
    const total = sumPhases([
      [
        { phase: "Factory", ms: 2 },
        { phase: "Implement", ms: 10 },
      ],
      [
        { phase: "Factory", ms: 3 },
        { phase: "Implement", ms: 5 },
        { phase: "Review", ms: 7 },
      ],
    ]);

    expect(total).toEqual([
      { phase: "Factory", ms: 5 },
      { phase: "Implement", ms: 15 },
      { phase: "Review", ms: 7 },
    ]);
  });
});

describe("currentPhase", () => {
  const now = 100 * M;

  it("is the phase of the subagent written most recently, when that was in the last 2 minutes", () => {
    expect(
      currentPhase(
        [
          { agent: "implementer", start: 10 * M, end: 70 * M },
          { agent: "code-reviewer", start: 80 * M, end: now - 30_000 },
        ],
        now,
      ),
    ).toBe("Review");
  });

  it("is Factory when the newest write is older than 2 minutes", () => {
    expect(currentPhase([{ agent: "implementer", start: 10 * M, end: now - 3 * M }], now)).toBe(
      "Factory",
    );
  });

  it("is Factory with no subagent", () => {
    expect(currentPhase([], now)).toBe("Factory");
  });
});

describe("unionSpans", () => {
  it("merges touching and overlapping spans and drops empty ones", () => {
    expect(
      unionSpans([
        { start: 5, end: 9 },
        { start: 0, end: 5 },
        { start: 7, end: 12 },
        { start: 20, end: 20 },
      ]),
    ).toEqual([{ start: 0, end: 12 }]);
  });
});
