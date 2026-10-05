import type {
  Attempt,
  Delivery,
  DeliveryDetail,
  InteractiveSession,
  QueueItem,
  Round,
  Snapshot,
  Source,
  Window,
  WatchdogStop,
  Worker,
} from "../../shared/schema.ts";
import type { FactoryRun, GithubRead, IssueRecord, Runner } from "../github.ts";
import type { OpencodeData, RunRecord } from "../opencode-db.ts";
import { aggregateFindings, findingsFromPr, NO_FINDINGS } from "./findings.ts";
import { currentPhase, LIVE_WINDOW_MS, runPhases, sumPhases } from "./phases.ts";
import { parseAssumptions, parseReviewSection, parseStatusLine } from "./pr-body.ts";
import { buildSpecs } from "./specs.ts";
import { parseReport } from "./report.ts";
import { canStartRun, deriveState } from "./state.ts";
import { computeStats, type StatRun } from "./stats.ts";

/** What one refresh read from the three sources. Every field is plain data. */
export interface Collected {
  now: number;
  demo: boolean;
  repo: string | null;
  github: { source: Source; data: Extract<GithubRead, { ok: true }> | null };
  opencode: { source: Source; data: OpencodeData | null };
  runLogs: { source: Source; stops: WatchdogStop[] };
}

const QUEUED = new Set(["queued", "waiting", "pending", "requested"]);

function kindOf(labels: readonly string[], head: string | null): Delivery["kind"] {
  for (const label of labels) {
    const m = /^(feature|task|bug):/.exec(label);
    if (m) return m[1] as Delivery["kind"];
  }
  const m = /^(feature|task|bug)\//.exec(head ?? "");
  return m ? (m[1] as Delivery["kind"]) : "other";
}

export interface FullDelivery {
  summary: Delivery;
  attempts: Attempt[];
  rounds: Round[];
  stops: WatchdogStop[];
  assumptions: string[];
  rejected: string[];
}

function ghRunsByIssue(c: Collected): Map<number, FactoryRun[]> {
  const map = new Map<number, FactoryRun[]>();
  for (const run of c.github.data?.runs ?? []) {
    if (run.issue === null) continue;
    map.set(run.issue, [...(map.get(run.issue) ?? []), run]);
  }
  return map;
}

function dbRunsByIssue(c: Collected): Map<number, RunRecord[]> {
  const map = new Map<number, RunRecord[]>();
  for (const run of c.opencode.data?.runs ?? []) {
    map.set(run.issue, [...(map.get(run.issue) ?? []), run]);
  }
  return map;
}

/** Every delivery with its attempts, rounds and stops (CONSOLE.md 2.2 to 2.4). */
export function buildDeliveries(c: Collected): FullDelivery[] {
  const now = c.now;
  const issues = new Map<number, IssueRecord>();
  for (const issue of c.github.data?.issues ?? []) issues.set(issue.number, issue);
  const gh = ghRunsByIssue(c);
  const db = dbRunsByIssue(c);
  const githubUp = c.github.data !== null;

  const numbers = new Set<number>([...gh.keys(), ...db.keys()]);
  for (const issue of issues.values()) {
    // A closed issue is listed when a factory run touched it (CONSOLE.md 1.1).
    if (issue.open || gh.has(issue.number) || db.has(issue.number)) numbers.add(issue.number);
  }

  const out: FullDelivery[] = [];
  for (const n of numbers) {
    const issue = issues.get(n) ?? null;
    const ghRuns = (gh.get(n) ?? []).sort((a, b) => b.createdAt - a.createdAt);
    const dbRuns = (db.get(n) ?? []).sort((a, b) => a.attempt - b.attempt || a.start - b.start);

    const runningGh = ghRuns.find((r) => r.status === "in_progress") ?? null;
    const queuedGh = ghRuns.find((r) => QUEUED.has(r.status)) ?? null;
    const latestDone = ghRuns.find((r) => r.status === "completed") ?? null;

    // Without GitHub, a run is live while any of its sessions was written in the last 2 minutes.
    const live = (run: RunRecord): boolean => {
      const end = Math.max(run.end, ...run.subagents.map((s) => s.end));
      if (githubUp) {
        if (!runningGh) return false;
        const newest = dbRuns[dbRuns.length - 1];
        return newest?.id === run.id;
      }
      return run.outcome === null && now - end <= LIVE_WINDOW_MS;
    };

    const stops = c.runLogs.stops.filter((s) => s.issue === n);
    const attempts: Attempt[] = dbRuns.map((run) => {
      const spans = run.subagents.map((s) => ({ agent: s.agent, start: s.start, end: s.end }));
      const isLive = live(run);
      const computed = runPhases(
        { start: run.start, end: isLive ? Math.max(run.end, now) : run.end },
        spans,
      );
      return {
        attempt: run.attempt,
        runId: run.id,
        mode: run.mode,
        start: computed.start,
        end: computed.end,
        live: isLive,
        intervals: computed.intervals,
        phases: computed.phases,
        stop: stops.find((s) => s.attempt === run.attempt)?.reason ?? null,
      };
    });

    const rounds: Round[] = [];
    for (const run of dbRuns) {
      run.subagents
        .filter((s) => s.agent === "review-verifier")
        .sort((a, b) => a.start - b.start)
        .forEach((s, i) => {
          rounds.push({
            round: i + 1,
            attempt: run.attempt,
            sessionId: s.id,
            report: s.text === null ? null : parseReport(s.text),
          });
        });
    }

    const pr = issue?.pr ?? null;
    const body = pr?.body ?? "";
    const reports = rounds.map((r) => r.report);
    let findings = aggregateFindings(reports);
    if (!findings.known && pr?.merged) {
      const review = parseReviewSection(body);
      if (review) findings = findingsFromPr(review);
    }
    if (rounds.length === 0 && !findings.known) findings = { ...NO_FINDINGS };

    const labels = issue?.labels ?? [];
    const open = issue ? issue.open : true;
    const hasRun = ghRuns.length > 0 || dbRuns.length > 0;
    let state = deriveState({
      issueOpen: open,
      issueLabels: labels,
      pr: pr ? { merged: pr.merged, labels: pr.labels } : null,
      running: githubUp ? runningGh !== null : attempts.some((a) => a.live),
      queued: queuedGh !== null,
      latestConclusion: latestDone?.conclusion ?? null,
      hasRun,
    });
    // GitHub is down and nothing says the issue is open: its database runs are history.
    if (!githubUp && state !== "running") state = "closed";

    const liveAttempt = attempts.find((a) => a.live) ?? null;
    const liveRun = liveAttempt ? dbRuns.find((r) => r.id === liveAttempt.runId) : undefined;
    const running = state === "running";
    const startedAt = running
      ? (runningGh?.startedAt ?? runningGh?.createdAt ?? liveAttempt?.start ?? null)
      : queuedGh
        ? queuedGh.createdAt
        : null;
    const phases = sumPhases(attempts.map((a) => a.phases));
    const lastActivityAt = Math.max(
      issue?.createdAt ?? 0,
      issue?.closedAt ?? 0,
      pr?.mergedAt ?? 0,
      ...ghRuns.map((r) => r.updatedAt),
      ...attempts.map((a) => a.end),
    );
    const prInfo = pr
      ? {
          number: pr.number,
          url: pr.url,
          state: pr.state,
          isDraft: pr.isDraft,
          merged: pr.merged,
          mergedAt: pr.mergedAt,
          labels: pr.labels,
        }
      : null;

    const reportRejected = reports.flatMap((r) => r?.rejected ?? []);
    const prRejected = parseReviewSection(body)?.rejected ?? [];
    const rejected = prRejected.length > 0 ? prRejected : reportRejected;

    out.push({
      summary: {
        issue: n,
        title: issue?.title ?? `Issue #${n}`,
        kind: kindOf(labels, pr?.head ?? null),
        state,
        labels,
        open,
        issueUrl: issue?.url ?? null,
        pr: prInfo,
        statusLine: parseStatusLine(body),
        currentPhase:
          running && liveRun
            ? currentPhase(
                liveRun.subagents.map((s) => ({ agent: s.agent, start: s.start, end: s.end })),
                now,
              )
            : null,
        elapsedMs: running && startedAt !== null ? Math.max(0, now - startedAt) : null,
        runStartedAt: startedAt,
        lastActivityAt,
        runs: Math.max(dbRuns.length, ghRuns.length),
        phases,
        totalMs: phases.reduce((sum, p) => sum + p.ms, 0),
        findings,
        canStart: canStartRun(state, open, labels),
      },
      attempts,
      rounds,
      stops,
      assumptions: parseAssumptions(body),
      rejected: [...new Set(rejected)],
    });
  }
  return out.sort((a, b) => b.summary.lastActivityAt - a.summary.lastActivityAt);
}

function workersOf(c: Collected, deliveries: readonly FullDelivery[]): Worker[] {
  const data = c.github.data;
  if (!data) return [];
  const byIssue = new Map(deliveries.map((d) => [d.summary.issue, d.summary]));
  const running = data.runs.filter((r) => r.status === "in_progress");
  let runners: Runner[] | null = data.runners;
  if (runners === null) {
    const names = new Set(
      data.runs.map((r) => r.runnerName).filter((n): n is string => n !== null),
    );
    runners = [...names]
      .sort()
      .map((name) => ({ name, online: running.some((r) => r.runnerName === name) }));
  }
  return runners.map((runner) => {
    const run = running.find((r) => r.runnerName === runner.name);
    const delivery = run?.issue ? byIssue.get(run.issue) : undefined;
    return {
      name: runner.name,
      online: data.runners === null && !runner.online ? null : runner.online,
      busy: run !== undefined,
      issue: run?.issue ?? null,
      title: delivery?.title ?? null,
      phase: delivery?.currentPhase ?? null,
      elapsedMs: run ? Math.max(0, c.now - (run.startedAt ?? run.createdAt)) : null,
    };
  });
}

function queueOf(c: Collected, deliveries: readonly FullDelivery[]): QueueItem[] {
  const byIssue = new Map(deliveries.map((d) => [d.summary.issue, d.summary]));
  return (c.github.data?.runs ?? [])
    .filter((r) => QUEUED.has(r.status) && r.issue !== null)
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((r) => ({
      issue: r.issue ?? 0,
      title: byIssue.get(r.issue ?? 0)?.title ?? null,
      waitingMs: Math.max(0, c.now - r.createdAt),
    }));
}

function statRuns(c: Collected, deliveries: readonly FullDelivery[]): StatRun[] {
  if (c.opencode.data) {
    const live = new Set(
      deliveries.flatMap((d) => d.attempts.filter((a) => a.live).map((a) => a.runId)),
    );
    return c.opencode.data.runs.map((run) => {
      const attempt = deliveries.flatMap((d) => d.attempts).find((a) => a.runId === run.id);
      return {
        issue: run.issue,
        start: run.start,
        end: attempt?.end ?? run.end,
        live: live.has(run.id),
        phases: attempt?.phases ?? [],
        costUsd: run.costUsd,
        tokens: run.tokens,
      };
    });
  }
  return (c.github.data?.runs ?? [])
    .filter((r) => r.issue !== null)
    .map((r) => ({
      issue: r.issue ?? 0,
      start: r.startedAt ?? r.createdAt,
      end: r.updatedAt,
      live: r.status !== "completed",
      phases: [],
      costUsd: null,
      tokens: null,
    }));
}

function interactiveOf(c: Collected): InteractiveSession[] {
  return c.opencode.data?.interactive ?? [];
}

export function buildSnapshot(
  c: Collected,
  window: Window,
  opencode: { available: boolean; version?: string },
): Snapshot {
  const full = buildDeliveries(c);
  const deliveries = full.map((d) => d.summary);
  return {
    generatedAt: c.now,
    demo: c.demo,
    repo: c.repo,
    sources: [c.github.source, c.opencode.source, c.runLogs.source],
    workersNote: c.github.data?.runnersNote ?? null,
    workers: workersOf(c, full),
    queue: queueOf(c, full),
    deliveries,
    stats: computeStats({
      window,
      now: c.now,
      runs: statRuns(c, full),
      deliveries,
      stops: c.runLogs.stops,
    }),
    interactive: interactiveOf(c),
    specs: buildSpecs(c.github.data?.specs ?? { waiting: [], features: [] }),
    opencode,
  };
}

export function buildDetail(c: Collected, issue: number): DeliveryDetail | null {
  const found = buildDeliveries(c).find((d) => d.summary.issue === issue);
  if (!found) return null;
  return {
    generatedAt: c.now,
    delivery: found.summary,
    attempts: found.attempts,
    rounds: found.rounds,
    stops: found.stops,
    assumptions: found.assumptions,
    rejected: found.rejected,
  };
}
