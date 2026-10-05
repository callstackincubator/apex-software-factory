import type {
  Delivery,
  PhaseStat,
  PhaseTotal,
  Stats,
  Window,
  WatchdogStop,
} from "../../shared/schema.ts";
import { addFindings } from "./findings.ts";

export interface StatRun {
  issue: number;
  start: number;
  /** A live run is not counted in the medians. */
  live: boolean;
  end: number;
  phases: PhaseTotal[];
  costUsd: number | null;
  tokens: { input: number; output: number; reasoning: number } | null;
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] ?? 0)
    : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/** The start of the window, in epoch ms; `today` is the local midnight. */
export function windowStart(window: Window, now: number): number {
  if (window === "all") return 0;
  if (window === "7d") return now - 7 * 24 * 3600 * 1000;
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** The kind of a watchdog stop, from the first words of its reason (`factory-run.sh`). */
export function stopKind(reason: string): string {
  if (/^no progress/i.test(reason)) return "stall";
  if (/^hard timeout/i.test(reason)) return "timeout";
  if (/ended on an error/i.test(reason)) return "provider error";
  if (/garbled/i.test(reason)) return "garbled turn";
  return reason.split(/\s+/).slice(0, 3).join(" ") || "unknown";
}

/** The totals of the Stats tab over a window, counted by a run's start time. */
export function computeStats(input: {
  window: Window;
  now: number;
  runs: readonly StatRun[];
  deliveries: readonly Delivery[];
  stops: readonly WatchdogStop[];
}): Stats {
  const from = windowStart(input.window, input.now);
  const runs = input.runs.filter((r) => r.start >= from);
  const issues = new Set(runs.map((r) => r.issue));
  const inWindow = input.deliveries.filter((d) => issues.has(d.issue));
  const count = (state: string) => inWindow.filter((d) => d.state === state).length;

  const finished = runs.filter((r) => !r.live);
  const names = new Map<string, number[]>();
  for (const run of finished) {
    for (const p of run.phases) {
      if (p.ms <= 0) continue;
      names.set(p.phase, [...(names.get(p.phase) ?? []), p.ms]);
    }
  }
  const phases: PhaseStat[] = [...names.entries()].map(([phase, values]) => ({
    phase,
    runs: values.length,
    medianMs: median(values) ?? 0,
    maxMs: Math.max(...values),
  }));

  const stops = input.stops.filter((s) => s.at >= from).sort((a, b) => b.at - a.at);
  const reasons = new Map<string, number>();
  for (const s of stops)
    reasons.set(stopKind(s.reason), (reasons.get(stopKind(s.reason)) ?? 0) + 1);

  const costed = runs.filter((r) => r.costUsd !== null);
  const tokened = runs.filter((r) => r.tokens !== null);
  return {
    window: input.window,
    runs: runs.length,
    merged: count("merged"),
    parked: count("parked"),
    blocked: count("blocked"),
    failed: count("failed"),
    watchdogStops: stops.length,
    watchdogReasons: [...reasons.entries()]
      .map(([reason, n]) => ({ reason, count: n }))
      .sort((a, b) => b.count - a.count),
    medianRunMs: median(finished.map((r) => r.end - r.start)),
    phases,
    findings: addFindings(inWindow.map((d) => d.findings)),
    perIssue: inWindow
      .filter((d) => d.findings.known)
      .map((d) => ({
        issue: d.issue,
        confirmed: d.findings.confirmed,
        rejected: d.findings.rejected,
        nits: d.findings.nits,
        unsorted: d.findings.unsorted,
      }))
      .sort((a, b) => a.issue - b.issue),
    watchdog: stops,
    costUsd: costed.length === 0 ? null : costed.reduce((n, r) => n + (r.costUsd ?? 0), 0),
    tokens:
      tokened.length === 0
        ? null
        : {
            input: tokened.reduce((n, r) => n + (r.tokens?.input ?? 0), 0),
            output: tokened.reduce((n, r) => n + (r.tokens?.output ?? 0), 0),
            reasoning: tokened.reduce((n, r) => n + (r.tokens?.reasoning ?? 0), 0),
          },
  };
}
