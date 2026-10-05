import { z } from "zod";

/** Every shape the console's server sends and its page reads (ADR 0016 §3). */

export const WINDOWS = ["today", "7d", "all"] as const;
export const Window = z.enum(WINDOWS);
export type Window = z.infer<typeof Window>;

export const STATES = [
  "merged",
  "running",
  "queued",
  "parked",
  "blocked",
  "failed",
  "ready",
  "triage",
  "closed",
] as const;
export const DeliveryState = z.enum(STATES);
export type DeliveryState = z.infer<typeof DeliveryState>;

export const Source = z.object({
  name: z.enum(["github", "opencode", "runLogs"]),
  status: z.enum(["ok", "unavailable"]),
  /** Why the source is unavailable; absent when it is ok. */
  reason: z.string().optional(),
  refreshedAt: z.number().nullable(),
});
export type Source = z.infer<typeof Source>;

export const PhaseTotal = z.object({ phase: z.string(), ms: z.number() });
export type PhaseTotal = z.infer<typeof PhaseTotal>;

export const Findings = z.object({
  /** Whether any verifier report (or a PR's Review section) fed these numbers. */
  known: z.boolean(),
  /** The counts came from the PR body, not from the database. */
  fromPr: z.boolean(),
  rounds: z.number(),
  raised: z.number(),
  blocking: z.number(),
  confirmed: z.number(),
  rejected: z.number(),
  nits: z.number(),
  unsorted: z.number(),
  specNeeds: z.number(),
});
export type Findings = z.infer<typeof Findings>;

export const PrInfo = z.object({
  number: z.number(),
  url: z.string(),
  state: z.string(),
  isDraft: z.boolean(),
  merged: z.boolean(),
  mergedAt: z.number().nullable(),
  labels: z.array(z.string()),
});
export type PrInfo = z.infer<typeof PrInfo>;

export const StatusField = z.object({ key: z.string(), value: z.string() });
export type StatusField = z.infer<typeof StatusField>;

export const Delivery = z.object({
  issue: z.number(),
  title: z.string(),
  kind: z.enum(["feature", "task", "bug", "other"]),
  state: DeliveryState,
  labels: z.array(z.string()),
  /** The issue is open. */
  open: z.boolean(),
  issueUrl: z.string().nullable(),
  pr: PrInfo.nullable(),
  statusLine: z.array(StatusField),
  /** The current phase of a live run, else null. */
  currentPhase: z.string().nullable(),
  /** How long the live run has been going. */
  elapsedMs: z.number().nullable(),
  /** When the oldest queued or running run began waiting or running. */
  runStartedAt: z.number().nullable(),
  lastActivityAt: z.number(),
  runs: z.number(),
  /** Per-phase totals over every attempt, in order of first start. */
  phases: z.array(PhaseTotal),
  totalMs: z.number(),
  findings: Findings,
  /** The Start run button applies. */
  canStart: z.boolean(),
});
export type Delivery = z.infer<typeof Delivery>;

export const Worker = z.object({
  name: z.string(),
  /** null: unknown, the worker is known from a job alone. */
  online: z.boolean().nullable(),
  busy: z.boolean(),
  issue: z.number().nullable(),
  title: z.string().nullable(),
  phase: z.string().nullable(),
  elapsedMs: z.number().nullable(),
});
export type Worker = z.infer<typeof Worker>;

export const QueueItem = z.object({
  issue: z.number(),
  title: z.string().nullable(),
  waitingMs: z.number(),
});
export type QueueItem = z.infer<typeof QueueItem>;

export const PhaseStat = z.object({
  phase: z.string(),
  runs: z.number(),
  medianMs: z.number(),
  maxMs: z.number(),
});
export type PhaseStat = z.infer<typeof PhaseStat>;

export const WatchdogStop = z.object({
  at: z.number(),
  issue: z.number(),
  attempt: z.number(),
  reason: z.string(),
});
export type WatchdogStop = z.infer<typeof WatchdogStop>;

export const IssueFindings = z.object({
  issue: z.number(),
  confirmed: z.number(),
  rejected: z.number(),
  nits: z.number(),
  unsorted: z.number(),
});
export type IssueFindings = z.infer<typeof IssueFindings>;

export const Stats = z.object({
  window: Window,
  runs: z.number(),
  merged: z.number(),
  parked: z.number(),
  blocked: z.number(),
  failed: z.number(),
  watchdogStops: z.number(),
  /** Stops by the reason's first words, most frequent first. */
  watchdogReasons: z.array(z.object({ reason: z.string(), count: z.number() })),
  medianRunMs: z.number().nullable(),
  phases: z.array(PhaseStat),
  findings: Findings,
  perIssue: z.array(IssueFindings),
  watchdog: z.array(WatchdogStop),
  costUsd: z.number().nullable(),
  tokens: z.object({ input: z.number(), output: z.number(), reasoning: z.number() }).nullable(),
});
export type Stats = z.infer<typeof Stats>;

export const InteractiveSession = z.object({
  id: z.string(),
  title: z.string(),
  agent: z.string().nullable(),
  directory: z.string(),
  updatedAt: z.number(),
  costUsd: z.number().nullable(),
});
export type InteractiveSession = z.infer<typeof InteractiveSession>;

export const Snapshot = z.object({
  generatedAt: z.number(),
  demo: z.boolean(),
  repo: z.string().nullable(),
  sources: z.array(Source),
  /** Set when the runner list could not be read, e.g. "runner list needs admin access". */
  workersNote: z.string().nullable(),
  workers: z.array(Worker),
  queue: z.array(QueueItem),
  deliveries: z.array(Delivery),
  stats: Stats,
  interactive: z.array(InteractiveSession),
  /** Whether the `opencode` CLI is on PATH, and its version. */
  opencode: z.object({ available: z.boolean(), version: z.string().optional() }),
});
export type Snapshot = z.infer<typeof Snapshot>;

export const Interval = z.object({
  phase: z.string(),
  agent: z.string(),
  start: z.number(),
  end: z.number(),
});
export type Interval = z.infer<typeof Interval>;

export const Report = z.object({
  pr: z.number().nullable(),
  round: z.number().nullable(),
  kind: z.string().nullable(),
  specFindings: z.number().nullable(),
  specBlocking: z.number().nullable(),
  specSkipped: z.boolean(),
  codeFindings: z.number().nullable(),
  codeBlocking: z.number().nullable(),
  codeSkipped: z.boolean(),
  fix: z.array(z.string()),
  nits: z.array(z.string()),
  rejected: z.array(z.string()),
  specNeeds: z.string().nullable(),
  rerun: z.string().nullable(),
});
export type Report = z.infer<typeof Report>;

export const Attempt = z.object({
  attempt: z.number(),
  runId: z.string(),
  mode: z.enum(["deliver", "triage"]),
  start: z.number(),
  end: z.number(),
  live: z.boolean(),
  intervals: z.array(Interval),
  phases: z.array(PhaseTotal),
  stop: z.string().nullable(),
});
export type Attempt = z.infer<typeof Attempt>;

export const Round = z.object({
  /** 1-based, in order within the attempt. */
  round: z.number(),
  attempt: z.number(),
  sessionId: z.string(),
  report: Report.nullable(),
});
export type Round = z.infer<typeof Round>;

export const DeliveryDetail = z.object({
  generatedAt: z.number(),
  delivery: Delivery,
  attempts: z.array(Attempt),
  rounds: z.array(Round),
  stops: z.array(WatchdogStop),
  assumptions: z.array(z.string()),
  rejected: z.array(z.string()),
});
export type DeliveryDetail = z.infer<typeof DeliveryDetail>;

export const RunRequest = z.object({ issue: z.number().int().positive() });
export const RunResponse = z.object({ dispatched: z.literal(true), issue: z.number() });
export const OpencodeResponse = z.object({ url: z.string(), expiresInMinutes: z.number() });
export const ErrorBody = z.object({ error: z.string() });

export const WorkflowInput = z.object({
  name: z.string(),
  required: z.boolean(),
  description: z.string(),
});
export type WorkflowInput = z.infer<typeof WorkflowInput>;

export const RUN_WORDS = [
  "success",
  "failure",
  "timed_out",
  "startup_failure",
  "cancelled",
  "skipped",
  "in_progress",
  "queued",
  "waiting",
  "unknown",
] as const;

export const AutomationRun = z.object({
  id: z.number(),
  event: z.string(),
  /** The status word: the conclusion of a finished run, else its status. */
  word: z.string(),
  startedAt: z.number(),
  durationMs: z.number().nullable(),
  url: z.string(),
});
export type AutomationRun = z.infer<typeof AutomationRun>;

export const Automation = z.object({
  file: z.string(),
  name: z.string(),
  description: z.string(),
  url: z.string().nullable(),
  /** `workflow_dispatch`, `push`, `schedule`, ... as written in the file. */
  events: z.array(z.string()),
  crons: z.array(z.string()),
  /** Each cron in words, or as itself when it is not a plain one. */
  schedule: z.array(z.object({ cron: z.string(), words: z.string().nullable() })),
  nextRun: z.number().nullable(),
  /** A scheduled time passed with no run since; GitHub runs schedules late. */
  dueSince: z.number().nullable(),
  state: z.string(),
  status: z.enum(["healthy", "failing", "disabled"]),
  lastRun: AutomationRun.nullable(),
  /** Success over completed runs among the last 20; null with none. */
  successRate: z.number().nullable(),
  medianMs: z.number().nullable(),
  inputs: z.array(WorkflowInput),
  runsOn: z.array(z.string()),
  selfHosted: z.boolean(),
  /** Run now applies; otherwise why not. */
  dispatchable: z.boolean(),
  dispatchRefusal: z.string().nullable(),
});
export type Automation = z.infer<typeof Automation>;

export const AutomationsResponse = z.object({
  generatedAt: z.number(),
  repo: z.string().nullable(),
  /** Why GitHub's half is missing, or why the files are. */
  notes: z.array(z.string()),
  automations: z.array(Automation),
});
export type AutomationsResponse = z.infer<typeof AutomationsResponse>;

export const AutomationDetail = z.object({
  generatedAt: z.number(),
  automation: Automation,
  runs: z.array(AutomationRun),
});
export type AutomationDetail = z.infer<typeof AutomationDetail>;
