import type { DeliveryState } from "../../shared/schema.ts";

export const READY_LABELS = ["feature:ready", "task:ready", "bug:ready"] as const;
export const TRIAGE_LABEL = "bug:triage";

export interface StateInput {
  issueOpen: boolean;
  issueLabels: readonly string[];
  pr: { merged: boolean; labels: readonly string[] } | null;
  /** Some factory run for the issue is in progress. */
  running: boolean;
  /** Some factory run for the issue is queued. */
  queued: boolean;
  /** The conclusion of its latest finished factory run, if it has one. */
  latestConclusion: string | null;
  /** It has at least one factory run, in any state. */
  hasRun: boolean;
}

export function hasReadyLabel(labels: readonly string[]): boolean {
  return labels.some((label) => (READY_LABELS as readonly string[]).includes(label));
}

/** One word per issue, the first row of the table in CONSOLE.md 2.2 that applies. */
export function deriveState(input: StateInput): DeliveryState {
  if (input.pr?.merged) return "merged";
  if (input.running) return "running";
  if (input.queued) return "queued";
  if (
    input.pr?.labels.includes("needs-native-build") ||
    input.pr?.labels.includes("needs-simulator")
  ) {
    return "parked";
  }
  if (input.issueLabels.some((label) => /^(feature|task|bug):blocked$/.test(label))) {
    return "blocked";
  }
  if (
    input.latestConclusion !== null &&
    ["failure", "cancelled", "timed_out"].includes(input.latestConclusion)
  ) {
    return "failed";
  }
  if (!input.issueOpen) return "closed";
  if (hasReadyLabel(input.issueLabels) && !input.hasRun) return "ready";
  if (input.issueLabels.includes(TRIAGE_LABEL) && !input.hasRun) return "triage";
  // Not in the table: an open issue that still carries a label agents act on, after a run that
  // did not fail. It waits for a person to start it again, so it reads as what it carries.
  if (hasReadyLabel(input.issueLabels)) return "ready";
  if (input.issueLabels.includes(TRIAGE_LABEL)) return "triage";
  return "closed";
}

/** Whether the Start run button applies (CONSOLE.md Pipeline). */
export function canStartRun(state: DeliveryState, issueOpen: boolean, labels: readonly string[]) {
  if (!issueOpen) return false;
  if (state === "ready" || state === "triage" || state === "failed") {
    return hasReadyLabel(labels) || labels.includes(TRIAGE_LABEL);
  }
  if (state === "blocked") return hasReadyLabel(labels);
  return false;
}
