import type { Interval, PhaseTotal } from "../../shared/schema.ts";

export const FACTORY = "Factory";
export const LIVE_WINDOW_MS = 2 * 60 * 1000;

const PHASES: Readonly<Record<string, string>> = {
  implementer: "Implement",
  "spec-reviewer": "Review",
  "code-reviewer": "Review",
  "review-verifier": "Verify",
  "mobile-verifier": "Simulator",
  "ota-verifier": "OTA check",
  triager: "Triage",
  "spec-checker": "Spec check",
};

/** The phase a subagent belongs to; an unknown agent is its own phase. */
export function phaseOf(agent: string): string {
  return PHASES[agent] ?? agent;
}

export interface Span {
  start: number;
  end: number;
}

/** Merges overlapping spans; the result is sorted and disjoint. */
export function unionSpans(spans: readonly Span[]): Span[] {
  const sorted = spans
    .filter((s) => s.end > s.start)
    .map((s) => ({ ...s }))
    .sort((a, b) => a.start - b.start);
  const out: Span[] = [];
  for (const span of sorted) {
    const last = out[out.length - 1];
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end);
    else out.push(span);
  }
  return out;
}

export function spanMs(spans: readonly Span[]): number {
  return unionSpans(spans).reduce((sum, s) => sum + (s.end - s.start), 0);
}

export interface SubagentSpan {
  agent: string;
  start: number;
  end: number;
}

export interface RunPhases {
  /** The subagents' intervals, in order of start. */
  intervals: Interval[];
  /** Per-phase time (the union of each phase's intervals), in order of first start. */
  phases: PhaseTotal[];
  /** The run's span, widened to hold every subagent. */
  start: number;
  end: number;
}

/**
 * A run's time per phase. A phase's time is the union of its subagents' intervals, so the two
 * parallel reviewers count their overlap once. Factory is what is left of the run's own span.
 */
export function runPhases(run: Span, subagents: readonly SubagentSpan[]): RunPhases {
  const start = Math.min(run.start, ...subagents.map((s) => s.start));
  const end = Math.max(run.end, ...subagents.map((s) => s.end));
  const intervals: Interval[] = subagents
    .map((s) => ({ phase: phaseOf(s.agent), agent: s.agent, start: s.start, end: s.end }))
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const covered = unionSpans(intervals);
  const factory: Span[] = [];
  let cursor = start;
  for (const span of covered) {
    if (span.start > cursor) factory.push({ start: cursor, end: span.start });
    cursor = Math.max(cursor, span.end);
  }
  if (end > cursor) factory.push({ start: cursor, end });

  const byPhase = new Map<string, Span[]>();
  const add = (phase: string, span: Span) => {
    const list = byPhase.get(phase) ?? [];
    list.push(span);
    byPhase.set(phase, list);
  };
  for (const i of intervals) add(i.phase, i);
  for (const f of factory) add(FACTORY, f);

  const phases = [...byPhase.entries()]
    .map(([phase, spans]) => ({
      phase,
      ms: spanMs(spans),
      first: Math.min(...spans.map((s) => s.start)),
    }))
    .sort((a, b) => a.first - b.first)
    .map(({ phase, ms }) => ({ phase, ms }));
  return { intervals, phases, start, end };
}

/** Adds the per-phase totals of several attempts; the order is the first appearance. */
export function sumPhases(lists: readonly (readonly PhaseTotal[])[]): PhaseTotal[] {
  const totals = new Map<string, number>();
  for (const list of lists) {
    for (const p of list) totals.set(p.phase, (totals.get(p.phase) ?? 0) + p.ms);
  }
  return [...totals.entries()].map(([phase, ms]) => ({ phase, ms }));
}

/**
 * The phase a live run is in: its newest-written subagent's, if that was written in the last
 * 2 minutes; otherwise Factory.
 */
export function currentPhase(subagents: readonly SubagentSpan[], now: number): string {
  let newest: SubagentSpan | undefined;
  for (const s of subagents) {
    if (newest === undefined || s.end > newest.end) newest = s;
  }
  if (newest !== undefined && now - newest.end <= LIVE_WINDOW_MS) return phaseOf(newest.agent);
  return FACTORY;
}
