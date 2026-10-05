import type { Findings, Report } from "../../shared/schema.ts";
import type { ReviewSection } from "./pr-body.ts";

export const NO_FINDINGS: Findings = {
  known: false,
  fromPr: false,
  rounds: 0,
  raised: 0,
  blocking: 0,
  confirmed: 0,
  rejected: 0,
  nits: 0,
  unsorted: 0,
  specNeeds: 0,
};

/** The findings of several rounds (CONSOLE.md 2.4). `null` is a round with no report. */
export function aggregateFindings(reports: readonly (Report | null)[]): Findings {
  const parsed = reports.filter((r): r is Report => r !== null);
  const raised = parsed.reduce((n, r) => n + (r.specFindings ?? 0) + (r.codeFindings ?? 0), 0);
  const blocking = parsed.reduce((n, r) => n + (r.specBlocking ?? 0) + (r.codeBlocking ?? 0), 0);
  const confirmed = parsed.reduce((n, r) => n + r.fix.length, 0);
  const rejected = parsed.reduce((n, r) => n + r.rejected.length, 0);
  const nits = parsed.reduce((n, r) => n + r.nits.length, 0);
  return {
    known: parsed.length > 0,
    fromPr: false,
    rounds: reports.length,
    raised,
    blocking,
    confirmed,
    rejected,
    nits,
    unsorted: Math.max(0, blocking - confirmed - rejected),
    specNeeds: parsed.filter((r) => r.specNeeds !== null).length,
  };
}

/** The findings a merged PR's own `## Review` counts give, when the database has no report. */
export function findingsFromPr(review: ReviewSection): Findings {
  return {
    ...NO_FINDINGS,
    known: true,
    fromPr: true,
    raised: review.specFindings + review.codeFindings,
    confirmed: review.specFixed + review.codeFixed,
    rejected: review.rejected.length,
  };
}

export function addFindings(list: readonly Findings[]): Findings {
  const sum = { ...NO_FINDINGS };
  for (const f of list) {
    sum.known ||= f.known;
    sum.fromPr ||= f.fromPr;
    sum.rounds += f.rounds;
    sum.raised += f.raised;
    sum.blocking += f.blocking;
    sum.confirmed += f.confirmed;
    sum.rejected += f.rejected;
    sum.nits += f.nits;
    sum.unsorted += f.unsorted;
    sum.specNeeds += f.specNeeds;
  }
  return sum;
}
