import type { ChatMessage, ChatForm, ChatState, Source, WatchdogStop } from "../shared/schema.ts";
import { ChatNotFound, roleFor, type ChatService } from "./chat.ts";
import type { Collected } from "./derive/deliveries.ts";
import type { FactoryRun, IssueRecord, PrRecord, SpecIssue } from "./github.ts";
import type { RunRecord, Subagent } from "./opencode-db.ts";
import { previousRun } from "./derive/cron.ts";
import type { AutomationsCollector, Collector } from "./service.ts";
import {
  readWorkflowFiles,
  type AutomationsRead,
  type WorkflowFile,
  type WorkflowRun,
} from "./workflows.ts";

/**
 * The sample the console shows with `--demo` (CONSOLE.md 3): the raw readings of the three
 * sources, as GitHub and OpenCode would give them, so the page runs through the same derivations
 * as real data. Every time is relative to `now`, so the page always looks live.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const REPO = "callstackincubator/apex-software-factory";

interface Step {
  agent: string;
  /** Minutes after the run started. */
  at: number;
  /** Minutes it lasted. */
  dur: number;
  text?: string;
}

interface ReportInput {
  pr: number;
  round: 1 | 2;
  spec: [number, number] | null;
  code: [number, number] | null;
  fix?: string[];
  nits?: string[];
  rejected?: string[];
  needs?: string;
  rerun?: string;
}

function list(key: string, items: readonly string[] | undefined): string {
  if (!items || items.length === 0) return `${key}: none`;
  if (items.length === 1) return `${key}: ${items[0]}`;
  return `${key}:\n${items.map((i) => `- ${i}`).join("\n")}`;
}

function report(r: ReportInput): string {
  const count = (v: [number, number] | null) =>
    v === null ? "skipped" : `${v[0]} findings (${v[1]} blocking)`;
  return [
    `Checked both reviews against the code in the worktree.`,
    ``,
    `PR: #${r.pr}  Round: ${r.round}  Kind: code`,
    `Spec review: ${count(r.spec)}  Code review: ${count(r.code)}`,
    list("Fix", r.fix),
    list("Nits", r.nits),
    list("Rejected", r.rejected),
    `Spec needs: ${r.needs ?? "none"}`,
    `Rerun: ${r.rerun ?? "none"}`,
  ].join("\n");
}

let sequence = 0;
function id(prefix: string): string {
  sequence += 1;
  return `ses_${prefix}${String(sequence).padStart(4, "0")}`;
}

function buildRun(
  now: number,
  issue: number,
  attempt: number,
  startedAgo: number,
  lengthMin: number,
  steps: readonly Step[],
  options: {
    mode?: "deliver" | "triage";
    cost?: number;
    endsNow?: boolean;
    outcome?: "succeeded" | "failed" | "interrupted";
  } = {},
): RunRecord {
  const start = now - startedAgo;
  const subagents: Subagent[] = steps.map((s) => ({
    id: id("sub"),
    agent: s.agent,
    start: start + s.at * MIN,
    end: Math.min(start + (s.at + s.dur) * MIN, options.endsNow ? now - 20_000 : Infinity),
    text: s.agent === "review-verifier" ? (s.text ?? null) : null,
  }));
  const end = options.endsNow ? now - 5_000 : start + lengthMin * MIN;
  const cost = options.cost ?? 1.2 + lengthMin * 0.045;
  return {
    id: id("run"),
    mode: options.mode ?? "deliver",
    issue,
    attempt,
    start,
    end,
    outcome: options.endsNow ? null : (options.outcome ?? "succeeded"),
    costUsd: Number(cost.toFixed(2)),
    tokens: {
      input: Math.round(lengthMin * 41_000),
      output: Math.round(lengthMin * 3_900),
      reasoning: Math.round(lengthMin * 2_300),
    },
    subagents,
  };
}

/** A typical delivery: implement, two reviews and a simulator proof in parallel, verify, gate. */
function typical(scale: number, verifier: readonly string[], native = false): Step[] {
  const s = (n: number) => Math.round(n * scale * 10) / 10;
  const steps: Step[] = [
    { agent: "implementer", at: s(2), dur: s(16) },
    { agent: "spec-reviewer", at: s(20), dur: s(5) },
    { agent: "code-reviewer", at: s(20), dur: s(8) },
  ];
  if (!native) steps.push({ agent: "mobile-verifier", at: s(21), dur: s(11) });
  steps.push({ agent: "review-verifier", at: s(29), dur: s(3), text: verifier[0] ?? "" });
  if (verifier.length > 1) {
    steps.push(
      { agent: "implementer", at: s(32), dur: s(6) },
      { agent: "code-reviewer", at: s(38), dur: s(4) },
      { agent: "review-verifier", at: s(42), dur: s(2), text: verifier[1] ?? "" },
    );
  }
  return steps;
}

function body(options: {
  status: string;
  review?: string;
  rejected?: readonly string[];
  assumptions?: readonly string[];
  closes: number;
}): string {
  const lines = [
    `Closes #${options.closes}`,
    ``,
    `## Summary`,
    ``,
    `A visitor can do the thing the issue describes, and the screen says so in plain words.`,
    ``,
    `### Status`,
    ``,
    options.status,
    ``,
    `## Done when`,
    ``,
    `- [x] The behaviour in the issue works on the simulator`,
    ``,
    `## Assumptions`,
    ``,
    ...(options.assumptions && options.assumptions.length > 0
      ? options.assumptions.map((a) => `- Assumption: ${a}`)
      : ["none"]),
  ];
  if (options.review) {
    lines.push(``, `## Review`, ``, options.review);
    if (options.rejected && options.rejected.length > 0) {
      lines.push(``, `Rejected:`, ``, ...options.rejected.map((r) => `- ${r}`));
    }
    lines.push(``, `_Written by an agent._`);
  }
  return lines.join("\n");
}

function sources(now: number): { ok: (name: Source["name"]) => Source } {
  return { ok: (name) => ({ name, status: "ok", refreshedAt: now }) };
}

/** The demo's three readings at `now`. */
/** Two requests and three feature specs; one request already has its feature. */
function demoSpecs(now: number): { waiting: SpecIssue[]; features: SpecIssue[] } {
  const spec = (
    number: number,
    title: string,
    labels: string[],
    body: string,
    updatedAgo: number,
  ): SpecIssue => ({
    number,
    title,
    url: `https://github.com/${REPO}/issues/${number}`,
    labels,
    body,
    createdAt: now - updatedAgo - 2 * HOUR,
    updatedAt: now - updatedAgo,
  });
  const request = (number: number, title: string, ago: number) =>
    spec(
      number,
      title,
      ["request:new"],
      "## The problem\nI never know which talk my friends pick.",
      ago,
    );
  const feature = (number: number, title: string, of: number, questions: string, ago: number) =>
    spec(
      number,
      title,
      ["feature:spec"],
      `Request: #${of}\n\n## Open questions\n${questions}\n\n## Technical spec\n<!-- to write -->`,
      ago,
    );
  const features = [
    feature(
      46,
      "Friends' talks on the schedule",
      43,
      "- Should a friend's pick show their full name?",
      25 * MIN,
    ),
    feature(47, "Lunch matching", 42, "<!-- none yet -->\nNone", 2 * HOUR),
    feature(48, "Save a talk for later", 40, "-", 5 * HOUR),
  ];
  return {
    waiting: [
      request(44, "Tell me when a talk is full", 10 * MIN),
      request(43, "See which talks my friends go to", 3 * HOUR),
      ...features,
    ],
    features,
  };
}

export function demoCollected(now: number): Collected {
  sequence = 0;
  const pr = (
    number: number,
    kind: string,
    issue: number,
    over: Partial<PrRecord> & { body: string },
  ): PrRecord => ({
    number,
    url: `https://github.com/${REPO}/pull/${number}`,
    state: "open",
    isDraft: false,
    merged: false,
    mergedAt: null,
    labels: [],
    head: `${kind}/${issue}`,
    ...over,
  });
  const issue = (
    number: number,
    title: string,
    labels: string[],
    createdAgo: number,
    over: Partial<IssueRecord> = {},
  ): IssueRecord => ({
    number,
    title,
    open: true,
    labels,
    url: `https://github.com/${REPO}/issues/${number}`,
    createdAt: now - createdAgo,
    closedAt: null,
    pr: null,
    ...over,
  });

  const runs: RunRecord[] = [];
  const ghRuns: FactoryRun[] = [];
  let ghId = 7_100;
  const ghRun = (
    n: number,
    agoStart: number,
    lengthMin: number,
    status: "completed" | "in_progress" | "queued",
    conclusion: string | null,
    runner: string | null,
  ) => {
    ghId += 1;
    const start = now - agoStart;
    ghRuns.push({
      id: ghId,
      issue: n,
      status,
      conclusion,
      createdAt: status === "queued" ? start : start - 20_000,
      startedAt: status === "queued" ? null : start,
      updatedAt: status === "completed" ? start + lengthMin * MIN : now - 4_000,
      runnerName: runner,
      url: `https://github.com/${REPO}/actions/runs/${ghId}`,
    });
  };

  // Merged, six days to one day ago.
  const merged = [
    {
      n: 27,
      t: "Welcome screen with the booth wordmark",
      k: "feature",
      ago: 6.2 * DAY,
      scale: 1.1,
      v: [
        report({
          pr: 127,
          round: 1,
          spec: [1, 0],
          code: [2, 1],
          fix: ["apps/mobile/src/app/index.tsx:41 title is not exposed to screen readers"],
          nits: ["apps/mobile/src/app/index.tsx:12 unused import"],
        }),
      ],
      review: "Spec review: 1 findings, 0 fixed. Code review: 2 findings, 1 fixed.",
    },
    {
      n: 28,
      t: "Show the visitor's name on the home screen",
      k: "feature",
      ago: 5.1 * DAY,
      scale: 0.9,
      v: [
        report({
          pr: 128,
          round: 1,
          spec: [0, 0],
          code: [1, 0],
          nits: ["apps/mobile/src/components/greeting.tsx:8 name is trimmed twice"],
        }),
      ],
      review: "Spec review: 0 findings, 0 fixed. Code review: 1 findings, 0 fixed.",
    },
    {
      n: 29,
      t: "Mood picker with five emoji faces",
      k: "feature",
      ago: 4.0 * DAY,
      scale: 1.3,
      v: [
        report({
          pr: 129,
          round: 1,
          spec: [2, 1],
          code: [3, 2],
          fix: [
            "apps/mobile/src/components/mood-picker.tsx:57 selected face has no accessibilityState",
            "apps/mobile/src/components/mood-picker.test.tsx:30 test asserts the mock, not the screen",
            "apps/mobile/src/app/index.tsx:64 state is lost on rotation",
          ],
          rejected: ["The picker should persist to the API — the spec says local only"],
          rerun: "both",
        }),
        report({
          pr: 129,
          round: 2,
          spec: [0, 0],
          code: [1, 0],
          nits: ["apps/mobile/src/components/mood-picker.tsx:12 magic number 5"],
        }),
      ],
      review: "Spec review: 2 findings, 1 fixed. Code review: 4 findings, 2 fixed.",
      rejected: ["The picker should persist to the API — the spec says local only"],
    },
    {
      n: 31,
      t: "Haptic tick when a card is flipped",
      k: "task",
      ago: 2.9 * DAY,
      scale: 0.8,
      v: [report({ pr: 131, round: 1, spec: [0, 0], code: [0, 0] })],
      review: "Spec review: 0 findings, 0 fixed. Code review: 0 findings, 0 fixed.",
    },
    {
      n: 34,
      t: "Leaderboard list with pull to refresh",
      k: "feature",
      ago: 1.7 * DAY,
      scale: 1.5,
      v: [
        report({
          pr: 134,
          round: 1,
          spec: [1, 1],
          code: [2, 1],
          fix: [
            "packages/contract/src/leaderboard.ts:18 score is z.number() but the API sends a string",
            "apps/mobile/src/app/leaderboard.tsx:73 refresh spinner never stops on error",
          ],
          rerun: "code",
        }),
        report({
          pr: 134,
          round: 2,
          spec: null,
          code: [0, 0],
          nits: ["apps/mobile/src/app/leaderboard.tsx:90 inline style"],
        }),
      ],
      review: "Spec review: 1 findings, 1 fixed. Code review: 2 findings, 1 fixed.",
    },
    {
      n: 36,
      t: "Settings screen with a sound on/off switch",
      k: "task",
      ago: 0.9 * DAY,
      scale: 1.0,
      v: [
        report({
          pr: 136,
          round: 1,
          spec: [0, 0],
          code: [1, 1],
          fix: [
            "apps/mobile/src/app/settings.tsx:33 switch label is not associated with the control",
          ],
        }),
        report({ pr: 136, round: 2, spec: null, code: [0, 0] }),
      ],
      review: "Spec review: 0 findings, 0 fixed. Code review: 1 findings, 1 fixed.",
    },
  ] as const;
  for (const m of merged) {
    const steps = typical(m.scale, m.v);
    const length = Math.round(55 * m.scale);
    steps.push({ agent: "ota-verifier", at: length + 1, dur: 3 });
    runs.push(buildRun(now, m.n, 1, m.ago, length + 4, steps));
    ghRun(
      m.n,
      m.ago,
      length + 4,
      "completed",
      "success",
      m.n % 2 === 0 ? "booth-factory-2" : "booth-factory-1",
    );
  }
  const mergedIssues = merged.map((m, i): IssueRecord => {
    const mergedAt = now - m.ago + Math.round(55 * m.scale) * MIN;
    return issue(m.n, m.t, [`${m.k}:done`], m.ago + 3 * HOUR, {
      open: false,
      closedAt: mergedAt,
      pr: pr(100 + m.n, m.k, m.n, {
        state: "merged",
        merged: true,
        mergedAt,
        body: body({
          closes: m.n,
          status:
            "Implement: done (6/6 green)  Review: round " +
            m.v.length +
            ", 0 open  Simulator: pass  Native: no  Gate: merged",
          review: m.review,
          ...("rejected" in m ? { rejected: m.rejected } : {}),
          assumptions: i === 2 ? ["Five moods are enough; the spec names no sixth."] : [],
        }),
      }),
    });
  });

  // #38 is in progress on booth-factory-1: Review, round 2.
  const live = buildRun(
    now,
    38,
    1,
    41 * MIN,
    41,
    [
      { agent: "implementer", at: 2, dur: 15 },
      { agent: "spec-reviewer", at: 18, dur: 4 },
      { agent: "code-reviewer", at: 18, dur: 7 },
      { agent: "mobile-verifier", at: 19, dur: 10 },
      {
        agent: "review-verifier",
        at: 26,
        dur: 3,
        text: report({
          pr: 138,
          round: 1,
          spec: [1, 0],
          code: [3, 2],
          fix: [
            "apps/mobile/src/app/leaderboard.tsx:52 rank column shows index, not rank",
            "apps/api/src/routes/leaderboard.ts:27 tie scores are ordered by insertion",
          ],
          nits: ["apps/mobile/src/app/leaderboard.tsx:18 stale comment"],
          rerun: "code",
        }),
      },
      { agent: "implementer", at: 29, dur: 6 },
      { agent: "code-reviewer", at: 35, dur: 6 },
    ],
    { endsNow: true, cost: 3.18 },
  );
  runs.push(live);
  ghRun(38, 41 * MIN, 41, "in_progress", null, "booth-factory-1");

  // #39 waits for a worker.
  ghRun(39, 6 * MIN + 20_000, 0, "queued", null, null);

  // #35: a native change, parked after review.
  runs.push(
    buildRun(
      now,
      35,
      1,
      5.2 * HOUR,
      47,
      typical(
        0.9,
        [
          report({
            pr: 135,
            round: 1,
            spec: [0, 0],
            code: [1, 0],
            nits: ["apps/mobile/src/components/confetti.tsx:22 prefer a named constant"],
          }),
        ],
        true,
      ),
    ),
  );
  ghRun(35, 5.2 * HOUR, 47, "completed", "success", "booth-factory-2");

  // #33: stopped twice by the watchdog; the handoff moved it to blocked.
  runs.push(
    buildRun(
      now,
      33,
      1,
      9.5 * HOUR,
      31,
      [
        { agent: "implementer", at: 2, dur: 12 },
        { agent: "spec-reviewer", at: 15, dur: 3 },
      ],
      { cost: 1.9, outcome: "interrupted" },
    ),
    buildRun(
      now,
      33,
      2,
      9.5 * HOUR - 36 * MIN,
      82,
      [
        { agent: "implementer", at: 2, dur: 29 },
        { agent: "code-reviewer", at: 34, dur: 11 },
        {
          agent: "review-verifier",
          at: 46,
          dur: 5,
          text: "I could not read the report; the reviewers' output was cut off.",
        },
      ],
      { cost: 3.6, outcome: "interrupted" },
    ),
  );
  ghRun(33, 9.5 * HOUR - 36 * MIN, 82, "completed", "failure", "booth-factory-1");

  // #37: a bug run that ended on a provider error twice.
  runs.push(
    buildRun(now, 37, 1, 3.1 * HOUR, 24, [{ agent: "implementer", at: 2, dur: 17 }], {
      cost: 1.4,
      outcome: "failed",
    }),
    buildRun(
      now,
      37,
      2,
      3.1 * HOUR - 28 * MIN,
      36,
      [
        { agent: "implementer", at: 2, dur: 21 },
        { agent: "code-reviewer", at: 24, dur: 7 },
      ],
      { cost: 2.1 },
    ),
  );
  ghRun(37, 3.1 * HOUR - 28 * MIN, 36, "completed", "failure", "booth-factory-2");

  // #32: closed by a person after a triage run: the sound would need a native build.
  runs.push(
    buildRun(now, 32, 1, 2.2 * DAY, 14, [{ agent: "triager", at: 1, dur: 11 }], {
      mode: "triage",
      cost: 0.66,
    }),
  );
  ghRun(32, 2.2 * DAY, 14, "completed", "success", "booth-factory-1");

  const stopped: WatchdogStop[] = [
    {
      at: now - 9.5 * HOUR + 31 * MIN + 17 * MIN,
      issue: 33,
      attempt: 1,
      reason: "no progress for 15 min",
    },
    {
      at: now - 9.5 * HOUR + 36 * MIN + 80 * MIN,
      issue: 33,
      attempt: 2,
      reason: "hard timeout (80 min for the run)",
    },
    {
      at: now - 3.1 * HOUR + 26 * MIN,
      issue: 37,
      attempt: 1,
      reason: "the agent's turn ended on an error (ServiceUnavailable)",
    },
    {
      at: now - 3.1 * HOUR + 28 * MIN + 38 * MIN,
      issue: 37,
      attempt: 2,
      reason: "the agent's last turn came back garbled (finish length, 0 text parts)",
    },
    { at: now - 1.4 * DAY, issue: 34, attempt: 1, reason: "no progress for 15 min" },
  ];

  const issues: IssueRecord[] = [
    ...mergedIssues,
    issue(38, "Pull to refresh on the leaderboard", ["feature:ready"], 3 * HOUR, {
      pr: pr(138, "feature", 38, {
        isDraft: true,
        body: body({
          closes: 38,
          status:
            "Implement: done (7/7 green)  Review: round 2, 1 open  Simulator: pass  Native: no  Gate: pending",
          assumptions: ["Refreshing keeps the visitor's own row highlighted."],
        }),
      }),
    }),
    issue(39, "Dark mode switch in settings", ["feature:ready"], 40 * MIN),
    issue(35, "Lottie confetti when a visitor finishes the quiz", ["task:ready"], 8 * HOUR, {
      pr: pr(135, "task", 35, {
        labels: ["needs-native-build"],
        body: body({
          closes: 35,
          status:
            "Implement: done (4/4 green)  Review: round 1, 0 open  Simulator: n/a  Native: yes  Gate: parked",
          review: "Spec review: 0 findings, 0 fixed. Code review: 1 findings, 0 fixed.",
          assumptions: ["lottie-react-native is acceptable as a new native dependency."],
        }),
      }),
    }),
    issue(33, "Share the visitor's card as an image", ["feature:blocked"], 11 * HOUR, {
      pr: pr(133, "feature", 33, {
        isDraft: true,
        body: body({
          closes: 33,
          status:
            "Implement: green (5/5)  Review: round 1, 2 open  Simulator: pending  Native: no  Gate: pending",
        }),
      }),
    }),
    issue(37, "Countdown shows negative seconds after the timer ends", ["bug:ready"], 4 * HOUR),
    issue(40, "Let visitors pick an avatar colour", ["feature:ready"], 25 * MIN),
    issue(
      41,
      "Rotating the phone on the settings screen crashes the app",
      ["bug:triage"],
      12 * MIN,
    ),
    issue(32, "Play a sound when the splash screen ends", ["wontfix"], 2.5 * DAY, {
      open: false,
      closedAt: now - 2.1 * DAY,
    }),
  ];

  const week = [
    { name: "booth-factory-1", online: true },
    { name: "booth-factory-2", online: true },
  ];

  return {
    now,
    demo: true,
    repo: REPO,
    github: {
      source: sources(now).ok("github"),
      data: {
        ok: true,
        repo: REPO,
        runners: week,
        runnersNote: null,
        runs: ghRuns,
        issues,
        specs: demoSpecs(now),
      },
    },
    opencode: {
      source: sources(now).ok("opencode"),
      data: {
        runs,
        interactive: [
          {
            id: id("int"),
            title: "Why is the leaderboard query slow?",
            agent: "build",
            directory: "/Users/booth/work/apex-software-factory",
            updatedAt: now - 14 * MIN,
            costUsd: 0.84,
          },
          {
            id: id("int"),
            title: "Spec session for #40: avatar colours",
            agent: "build",
            directory: "/Users/booth/work/apex-software-factory/.worktrees/spec-40",
            updatedAt: now - 2.6 * HOUR,
            costUsd: 1.37,
          },
          {
            id: id("int"),
            title: "Flaky haptics test in CI",
            agent: "build",
            directory: "/Users/booth/work/apex-software-factory/apps/mobile",
            updatedAt: now - 1.2 * DAY,
            costUsd: 2.05,
          },
        ],
      },
    },
    runLogs: { source: sources(now).ok("runLogs"), stops: stopped },
  };
}

/** A collector that serves the demo, rebuilt on every call so its times stay current. */
export function demoCollector(now: () => number = Date.now): Collector {
  return { collect: async () => demoCollected(now()) };
}

const invented: WorkflowFile[] = [
  {
    file: "stale-claims.yml",
    name: "Nightly stale-claim sweep",
    description:
      "Releases the claim on an issue whose run died without a handoff, so another run can pick it up.\nRuns on GitHub-hosted runners and touches labels only.",
    events: ["schedule", "workflow_dispatch"],
    crons: ["0 2 * * *"],
    inputs: [],
    runsOn: ["ubuntu-24.04"],
    selfHosted: false,
  },
  {
    file: "booth-health.yml",
    name: "Booth health check",
    description:
      "Pings the OTA server and the product API on the booth laptop during show hours and fails when either does not answer.",
    events: ["schedule", "workflow_dispatch"],
    crons: ["*/30 8-18 * * *"],
    inputs: [],
    runsOn: ["self-hosted", "factory"],
    selfHosted: true,
  },
];

/** The demo's automations: the repository's own workflow files plus two invented scheduled ones. */
export function demoAutomationsRead(now: number, dir: string): AutomationsRead {
  const real = readWorkflowFiles(dir).files;
  const files = [...real, ...invented];
  const states = new Map(files.map((f) => [f.file, "active"]));
  const runs = new Map<string, WorkflowRun[]>();
  let id = 9_000;
  const history = (
    file: string,
    event: string,
    count: number,
    everyMs: number,
    minMin: number,
    pick: (i: number) => string,
    sinceMs = 20 * MIN,
  ) => {
    runs.set(
      file,
      Array.from({ length: count }, (_, i) => {
        // Newest first, as GitHub lists them: the newest run has the highest id.
        const runId = id + count - i;
        const startedAt = now - sinceMs - i * everyMs;
        const word = pick(i);
        const duration = (minMin + ((i * 7) % 5) * 0.4) * MIN;
        return {
          id: runId,
          event,
          status: word === "in_progress" ? "in_progress" : "completed",
          conclusion: word === "in_progress" ? null : word,
          startedAt,
          updatedAt: word === "in_progress" ? now - 2_000 : startedAt + duration,
          url: `https://github.com/${REPO}/actions/runs/${runId}`,
        };
      }),
    );
    id += count;
  };
  history(
    "ci.yml",
    "pull_request",
    20,
    3.4 * HOUR,
    6.5,
    (i) => (i === 4 || i === 11 ? "failure" : i === 7 ? "cancelled" : "success"),
    1.5 * HOUR,
  );
  const onSchedule = (
    file: string,
    cron: string,
    count: number,
    minMin: number,
    pick: (i: number) => string,
    skip = 0,
  ) => {
    let at = previousRun(cron, now);
    for (let i = 0; i < skip && at !== null; i++) at = previousRun(cron, at - MIN);
    const list: WorkflowRun[] = [];
    for (let i = 0; i < count && at !== null; i++) {
      id += 1;
      const word = pick(i);
      const startedAt = at + 38_000;
      list.push({
        id,
        event: "schedule",
        status: "completed",
        conclusion: word,
        startedAt,
        updatedAt: startedAt + (minMin + ((i * 7) % 5) * 0.4) * MIN,
        url: `https://github.com/${REPO}/actions/runs/${id}`,
      });
      at = previousRun(cron, at - MIN);
    }
    runs.set(file, list);
  };
  // issue-state.yml's hourly tick has not started yet this hour: GitHub is late.
  onSchedule("issue-state.yml", "17 * * * *", 20, 0.4, () => "success", 1);
  history("labels.yml", "push", 6, 2.1 * DAY, 0.3, () => "success", 2.2 * DAY);
  history(
    "ota-publish.yml",
    "push",
    9,
    0.8 * DAY,
    4.2,
    (i) => (i === 3 ? "failure" : "success"),
    0.9 * DAY,
  );
  history(
    "factory.yml",
    "workflow_dispatch",
    20,
    3 * HOUR,
    52,
    (i) => (i === 0 ? "in_progress" : i === 2 || i === 5 ? "failure" : "success"),
    41 * MIN,
  );
  onSchedule("stale-claims.yml", "0 2 * * *", 14, 0.6, () => "success");
  onSchedule("booth-health.yml", "*/30 8-18 * * *", 20, 0.8, (i) =>
    i < 3 || i === 9 ? "failure" : "success",
  );
  return { now, repo: REPO, files, states, runs, notes: [] };
}

/** An automations collector that serves the demo, rebuilt on every call so its times stay current. */
export function demoAutomations(dir: string, now: () => number = Date.now): AutomationsCollector {
  return { collect: async () => demoAutomationsRead(now(), dir) };
}

/**
 * A scripted conversation for the Ideas tab, with no OpenCode: a greeting, a question as a form,
 * a draft. Nothing is filed. Replies are instant, so the page's polling has nothing to wait for.
 */
export function demoChat(): ChatService {
  interface Session {
    messages: ChatMessage[];
    forms: ChatForm[];
    turns: number;
    spec: boolean;
  }
  const sessions = new Map<string, Session>();
  let counter = 0;
  const get = (id: string) => {
    const session = sessions.get(id);
    if (session === undefined) throw new ChatNotFound(id);
    return session;
  };
  const say = (session: Session, text: string, tool?: string) => {
    counter += 1;
    session.messages.push({
      id: `msg_demo${counter}`,
      role: "agent",
      parts: [
        ...(tool === undefined
          ? []
          : [
              {
                kind: "tool" as const,
                tool: { name: "skill", status: "completed" as const, summary: tool },
              },
            ]),
        { kind: "text", text },
      ],
    });
  };
  const hear = (session: Session, text: string) => {
    counter += 1;
    session.messages.push({
      id: `msg_demo${counter}`,
      role: "user",
      parts: [{ kind: "text", text }],
    });
  };
  const askWho = (session: Session, idea: string) => {
    say(
      session,
      `So you want this: *${idea.slice(0, 120)}*\n\nOne question: **who** would use it?`,
    );
    session.forms = [
      {
        id: "frm_demo1",
        title: "Questions",
        fields: [
          {
            key: "q0",
            title: "Who",
            description: "Who runs into this, and when?",
            required: true,
            type: "string",
            custom: true,
            options: [
              { value: "Me, at the conference", label: "Me, at the conference" },
              { value: "Someone at home", label: "Someone at home" },
              { value: "My team", label: "My team" },
            ],
          },
        ],
      },
    ];
  };
  const draft = (session: Session) =>
    say(
      session,
      "Here is the request as I would file it:\n\n- **Title:** See which talks my friends go to\n- **Who:** me, at the conference\n- **What you would see:** a list of talks with a friend count\n\nShall I file this as it is, or change something? *(Demo: nothing is filed.)*",
      "loaded skill intent",
    );
  return {
    async start(request) {
      counter += 1;
      const sessionId = `ses_demo${counter}`;
      const session: Session = { messages: [], forms: [], turns: 0, spec: request.role === "spec" };
      if (request.role === "spec") {
        say(
          session,
          `This is the demo: I would run \`/spec ${roleFor(request).kickoff.text}\` for **#${request.issue}** (${request.mode}) and write the ${request.mode} spec with you. Nothing is edited on GitHub.`,
          "loaded skill spec-session",
        );
        sessions.set(sessionId, session);
        return { sessionId };
      }
      say(
        session,
        "Hello, and welcome to the booth. **What would you like the app to help with?**\n\nFor example:\n\n- keep track of the talks I want to see\n- find people to have lunch with",
        "loaded skill intent",
      );
      sessions.set(sessionId, session);
      return { sessionId };
    },
    async state(id): Promise<ChatState> {
      const session = get(id);
      return {
        messages: session.messages,
        forms: session.forms,
        permissionPending: false,
        running: false,
        failure: null,
      };
    },
    async send(id, text) {
      const session = get(id);
      session.turns += 1;
      hear(session, text);
      if (session.spec) say(session, "Noted. *(Demo: no issue is edited.)*");
      else if (session.turns === 1) askWho(session, text);
      else if (session.turns === 2) draft(session);
      else say(session, "This is the demo: nothing is filed, and I have no more to say.");
    },
    async answer(id, formId, answer) {
      const session = get(id);
      if (!session.forms.some((f) => f.id === formId)) throw new ChatNotFound(formId);
      session.forms = [];
      session.turns += 1;
      hear(session, Object.values(answer).map(String).join(", "));
      say(session, "Thanks. And what would you **see** when you open the app?");
    },
    async stop() {},
  };
}
