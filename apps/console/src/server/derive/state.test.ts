import { describe, expect, it } from "vitest";
import { canStartRun, deriveState, type StateInput } from "./state.ts";

const base: StateInput = {
  issueOpen: true,
  issueLabels: [],
  pr: null,
  running: false,
  queued: false,
  latestConclusion: null,
  hasRun: false,
};
const state = (over: Partial<StateInput>) => deriveState({ ...base, ...over });

describe("deriveState, one test per row of the table", () => {
  it("is merged when its PR is merged", () => {
    expect(state({ pr: { merged: true, labels: [] }, issueOpen: false })).toBe("merged");
  });

  it("is running while a factory run is in progress", () => {
    expect(state({ running: true, issueLabels: ["feature:ready"], hasRun: true })).toBe("running");
  });

  it("is queued while a factory run is queued", () => {
    expect(state({ queued: true, issueLabels: ["feature:ready"], hasRun: true })).toBe("queued");
  });

  it("is parked when its PR carries needs-native-build or needs-simulator", () => {
    expect(state({ pr: { merged: false, labels: ["needs-native-build"] } })).toBe("parked");
    expect(state({ pr: { merged: false, labels: ["needs-simulator"] } })).toBe("parked");
  });

  it("is blocked when the issue carries <kind>:blocked", () => {
    for (const kind of ["feature", "task", "bug"]) {
      expect(state({ issueLabels: [`${kind}:blocked`] })).toBe("blocked");
    }
  });

  it("is failed when its latest run concluded failure, cancelled or timed_out", () => {
    for (const conclusion of ["failure", "cancelled", "timed_out"]) {
      expect(state({ latestConclusion: conclusion, hasRun: true })).toBe("failed");
    }
  });

  it("is ready when it carries a ready label and has no run yet", () => {
    expect(state({ issueLabels: ["task:ready"] })).toBe("ready");
  });

  it("is triage when it carries bug:triage and has no run yet", () => {
    expect(state({ issueLabels: ["bug:triage"] })).toBe("triage");
  });

  it("is closed for anything else that is closed", () => {
    expect(state({ issueOpen: false, latestConclusion: "success", hasRun: true })).toBe("closed");
  });
});

describe("deriveState, the order between the rows", () => {
  it("calls a merged PR on an issue that still carries a ready label merged", () => {
    expect(
      state({ pr: { merged: true, labels: [] }, issueLabels: ["feature:ready"], running: true }),
    ).toBe("merged");
  });

  it("prefers running to queued, parked, blocked and failed", () => {
    expect(
      state({
        running: true,
        queued: true,
        pr: { merged: false, labels: ["needs-simulator"] },
        issueLabels: ["bug:blocked"],
        latestConclusion: "failure",
      }),
    ).toBe("running");
  });

  it("prefers parked to blocked, and blocked to failed", () => {
    expect(
      state({
        pr: { merged: false, labels: ["needs-native-build"] },
        issueLabels: ["task:blocked"],
      }),
    ).toBe("parked");
    expect(state({ issueLabels: ["task:blocked"], latestConclusion: "failure" })).toBe("blocked");
  });

  it("calls a failed run on a closed issue failed, and a ready label after a failed run failed", () => {
    expect(state({ issueOpen: false, latestConclusion: "failure" })).toBe("failed");
    expect(state({ issueLabels: ["bug:ready"], latestConclusion: "failure", hasRun: true })).toBe(
      "failed",
    );
  });
});

describe("canStartRun", () => {
  it("allows ready, triage and failed states with a label, and blocked only with a ready label", () => {
    expect(canStartRun("ready", true, ["feature:ready"])).toBe(true);
    expect(canStartRun("triage", true, ["bug:triage"])).toBe(true);
    expect(canStartRun("failed", true, ["bug:ready"])).toBe(true);
    expect(canStartRun("blocked", true, ["feature:ready", "feature:blocked"])).toBe(true);
    expect(canStartRun("blocked", true, ["feature:blocked"])).toBe(false);
  });

  it("refuses a closed issue, a running delivery and a merged one", () => {
    expect(canStartRun("ready", false, ["feature:ready"])).toBe(false);
    expect(canStartRun("running", true, ["feature:ready"])).toBe(false);
    expect(canStartRun("merged", true, [])).toBe(false);
  });
});
