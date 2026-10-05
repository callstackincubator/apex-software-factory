import { execFile } from "node:child_process";

/** Runs `gh` with the arguments and returns its stdout. Injected, so tests stub it. */
export type GhRunner = (args: readonly string[]) => Promise<string>;

export class GhError extends Error {
  readonly stderr: string;
  constructor(args: readonly string[], stderr: string) {
    super(`gh ${args.slice(0, 3).join(" ")} failed: ${stderr.trim() || "no output"}`);
    this.name = "GhError";
    this.stderr = stderr;
  }
  /** GitHub answered 403 or 404 (the token cannot see the resource). */
  get denied(): boolean {
    return /HTTP (403|404)/.test(this.stderr);
  }
}

/** The real runner: `gh` through `execFile`, never a shell, in `cwd`. */
export function ghRunner(cwd: string): GhRunner {
  return (args) =>
    new Promise((resolve, reject) => {
      execFile(
        "gh",
        [...args],
        { cwd, maxBuffer: 64 * 1024 * 1024, timeout: 45_000, env: process.env },
        (error, stdout, stderr) => {
          if (error) {
            const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
            reject(
              new GhError(args, missing ? "gh is not on PATH" : String(stderr || error.message)),
            );
          } else resolve(stdout);
        },
      );
    });
}

export interface Runner {
  name: string;
  online: boolean;
}

export interface FactoryRun {
  id: number;
  issue: number | null;
  /** `queued`, `in_progress`, `completed`, ... as GitHub says it. */
  status: string;
  conclusion: string | null;
  createdAt: number;
  startedAt: number | null;
  updatedAt: number;
  runnerName: string | null;
  url: string;
}

export interface PrRecord {
  number: number;
  url: string;
  state: string;
  isDraft: boolean;
  merged: boolean;
  mergedAt: number | null;
  labels: string[];
  /** The head branch, `<kind>/<n>`. */
  head: string;
  body: string;
}

export interface IssueRecord {
  number: number;
  title: string;
  open: boolean;
  labels: string[];
  url: string;
  createdAt: number;
  closedAt: number | null;
  pr: PrRecord | null;
}

/** An issue of the Specs tab: its body is read for the request link and the open questions. */
export interface SpecIssue {
  number: number;
  title: string;
  url: string;
  labels: string[];
  body: string;
  createdAt: number;
  updatedAt: number;
}

/** What the Specs tab reads: open `request:new` / `feature:spec` issues, and every feature. */
export interface SpecsRead {
  /** Open issues labelled `request:new` or `feature:spec`. */
  waiting: SpecIssue[];
  /** Open and closed issues labelled `feature:*`: the requests they answer are not waiting. */
  features: SpecIssue[];
}

export const EMPTY_SPECS: SpecsRead = { waiting: [], features: [] };

export type GithubRead =
  | {
      ok: true;
      repo: string;
      runners: Runner[] | null;
      runnersNote: string | null;
      runs: FactoryRun[];
      issues: IssueRecord[];
      specs: SpecsRead;
    }
  | { ok: false; reason: string; repo: string | null };

export const AGENT_LABELS = [
  "feature:ready",
  "task:ready",
  "bug:ready",
  "bug:triage",
  "feature:blocked",
  "task:blocked",
  "bug:blocked",
];

const time = (v: unknown): number | null => {
  const t = typeof v === "string" ? Date.parse(v) : Number.NaN;
  return Number.isNaN(t) ? null : t;
};
const asRecord = (v: unknown): Record<string, unknown> =>
  typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const text = (v: unknown): string => (typeof v === "string" ? v : "");

export async function resolveRepo(gh: GhRunner, configured: string | undefined): Promise<string> {
  if (configured) return configured;
  const out = await gh(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]);
  const repo = out.trim();
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo))
    throw new GhError(["repo", "view"], `unexpected output: ${repo}`);
  return repo;
}

async function api(gh: GhRunner, path: string): Promise<unknown> {
  return JSON.parse(await gh(["api", path]));
}

const GRAPHQL = `
query($owner: String!, $name: String!, $labels: [String!], $since: DateTime!) {
  repository(owner: $owner, name: $name) {
    open: issues(first: 100, states: OPEN, labels: $labels, orderBy: {field: UPDATED_AT, direction: DESC}) {
      nodes { ...IssueFields }
    }
    closed: issues(first: 100, states: CLOSED, filterBy: {since: $since}, orderBy: {field: UPDATED_AT, direction: DESC}) {
      nodes { ...IssueFields }
    }
    pullRequests(first: 100, orderBy: {field: UPDATED_AT, direction: DESC}) {
      nodes {
        number url state isDraft merged mergedAt headRefName body
        labels(first: 20) { nodes { name } }
      }
    }
  }
}
fragment IssueFields on Issue {
  number title state url createdAt closedAt
  labels(first: 30) { nodes { name } }
  assignees(first: 5) { nodes { login } }
}`;

/**
 * The Specs tab's own query, apart from `GRAPHQL` (and `AGENT_LABELS`, which drive the
 * pipeline). `features` is read to know which requests already have a feature.
 */
const SPECS_GRAPHQL = `
query($owner: String!, $name: String!, $waiting: [String!], $features: [String!]) {
  repository(owner: $owner, name: $name) {
    waiting: issues(first: 100, states: OPEN, labels: $waiting, orderBy: {field: UPDATED_AT, direction: DESC}) {
      nodes { ...SpecFields }
    }
    features: issues(first: 100, states: [OPEN, CLOSED], labels: $features, orderBy: {field: UPDATED_AT, direction: DESC}) {
      nodes { ...SpecFields }
    }
  }
}
fragment SpecFields on Issue {
  number title url body createdAt updatedAt
  labels(first: 30) { nodes { name } }
}`;

const WAITING_LABELS = ["request:new", "feature:spec"];
const FEATURE_LABELS = ["feature:spec", "feature:ready", "feature:planned", "feature:blocked"];

export function parseSpecs(data: unknown, now: number): SpecsRead {
  const repo = asRecord(asRecord(asRecord(data)["data"])["repository"]);
  const read = (key: string): SpecIssue[] =>
    asArray(asRecord(repo[key])["nodes"]).map((raw) => {
      const issue = asRecord(raw);
      return {
        number: Number(issue["number"]),
        title: text(issue["title"]),
        url: text(issue["url"]),
        labels: asArray(asRecord(issue["labels"])["nodes"]).map((l) => text(asRecord(l)["name"])),
        body: text(issue["body"]),
        createdAt: time(issue["createdAt"]) ?? now,
        updatedAt: time(issue["updatedAt"]) ?? now,
      };
    });
  return { waiting: read("waiting"), features: read("features") };
}

const HEAD = /^(feature|task|bug)\/(\d+)$/;

export function parseIssues(data: unknown, now: number): IssueRecord[] {
  const repo = asRecord(asRecord(asRecord(data)["data"])["repository"]);
  const prs = new Map<number, PrRecord>();
  for (const raw of asArray(asRecord(repo["pullRequests"])["nodes"])) {
    const pr = asRecord(raw);
    const head = HEAD.exec(text(pr["headRefName"]));
    if (!head) continue;
    const issue = Number(head[2]);
    if (prs.has(issue)) continue; // newest first: keep the most recently updated
    prs.set(issue, {
      number: Number(pr["number"]),
      url: text(pr["url"]),
      state: text(pr["state"]).toLowerCase(),
      isDraft: pr["isDraft"] === true,
      merged: pr["merged"] === true,
      mergedAt: time(pr["mergedAt"]),
      labels: asArray(asRecord(pr["labels"])["nodes"]).map((l) => text(asRecord(l)["name"])),
      head: text(pr["headRefName"]),
      body: text(pr["body"]),
    });
  }
  const issues = new Map<number, IssueRecord>();
  const week = now - 7 * 24 * 3600 * 1000;
  for (const key of ["open", "closed"] as const) {
    for (const raw of asArray(asRecord(repo[key])["nodes"])) {
      const issue = asRecord(raw);
      const number = Number(issue["number"]);
      const closedAt = time(issue["closedAt"]);
      const open = text(issue["state"]).toUpperCase() === "OPEN";
      if (!open && (closedAt === null || closedAt < week)) continue;
      issues.set(number, {
        number,
        title: text(issue["title"]),
        open,
        labels: asArray(asRecord(issue["labels"])["nodes"]).map((l) => text(asRecord(l)["name"])),
        url: text(issue["url"]),
        createdAt: time(issue["createdAt"]) ?? now,
        closedAt,
        pr: prs.get(number) ?? null,
      });
    }
  }
  return [...issues.values()];
}

/** Jobs of a run: the issue is the job's name, `#<n>`; the runner is its `runner_name`. */
function parseJobs(data: unknown): {
  issue: number | null;
  runner: string | null;
  startedAt: number | null;
} {
  const jobs = asArray(asRecord(data)["jobs"]).map(asRecord);
  for (const job of jobs) {
    const m = /^#(\d+)$/.exec(text(job["name"]));
    if (m) {
      return {
        issue: Number(m[1]),
        runner: text(job["runner_name"]) || null,
        startedAt: time(job["started_at"]),
      };
    }
  }
  return { issue: null, runner: null, startedAt: null };
}

/** Finished runs never change: their jobs are read once and kept. */
export interface GithubCache {
  jobs: Map<number, { issue: number | null; runner: string | null; startedAt: number | null }>;
}

export function newGithubCache(): GithubCache {
  return { jobs: new Map() };
}

async function inBatches<T, R>(items: readonly T[], size: number, fn: (item: T) => Promise<R>) {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  }
  return out;
}

/** Everything the console reads from GitHub (CONSOLE.md 1.1). */
export async function readGithub(
  gh: GhRunner,
  options: { repo: string | undefined; now: number; cache: GithubCache },
): Promise<GithubRead> {
  let repo: string | null = options.repo ?? null;
  try {
    repo = await resolveRepo(gh, options.repo);
    const [owner, name] = repo.split("/") as [string, string];

    let runners: Runner[] | null = null;
    let runnersNote: string | null = null;
    try {
      const data = await api(gh, `repos/${repo}/actions/runners?per_page=100`);
      runners = asArray(asRecord(data)["runners"])
        .map(asRecord)
        .filter((r) => asArray(r["labels"]).some((l) => asRecord(l)["name"] === "factory"))
        .map((r) => ({ name: text(r["name"]), online: r["status"] === "online" }));
    } catch (error) {
      if (!(error instanceof GhError) || !error.denied) throw error;
      runnersNote = "runner list needs admin access";
    }

    const runsData = await api(gh, `repos/${repo}/actions/workflows/factory.yml/runs?per_page=50`);
    const raw = asArray(asRecord(runsData)["workflow_runs"]).map(asRecord);
    const week = options.now - 7 * 24 * 3600 * 1000;
    const wanted = raw.filter((r) => {
      const active = text(r["status"]) !== "completed";
      return active || (time(r["created_at"]) ?? 0) >= week;
    });
    await inBatches(
      wanted.filter(
        (r) => text(r["status"]) !== "completed" || !options.cache.jobs.has(Number(r["id"])),
      ),
      6,
      async (r) => {
        const id = Number(r["id"]);
        const jobs = parseJobs(await api(gh, `repos/${repo}/actions/runs/${id}/jobs?per_page=100`));
        if (text(r["status"]) === "completed") options.cache.jobs.set(id, jobs);
        else options.cache.jobs.set(-id, jobs); // active: kept only for this read
      },
    );
    const runs: FactoryRun[] = wanted
      .map((r) => {
        const id = Number(r["id"]);
        const jobs = options.cache.jobs.get(id) ?? options.cache.jobs.get(-id);
        if (options.cache.jobs.has(-id)) options.cache.jobs.delete(-id);
        return {
          id,
          issue: jobs?.issue ?? null,
          status: text(r["status"]),
          conclusion: text(r["conclusion"]) || null,
          createdAt: time(r["created_at"]) ?? options.now,
          startedAt: jobs?.startedAt ?? time(r["run_started_at"]),
          updatedAt: time(r["updated_at"]) ?? options.now,
          runnerName: jobs?.runner ?? null,
          url: text(r["html_url"]),
        };
      })
      // A job that was skipped (a label agents ignore) is not a factory run.
      .filter((r) => r.conclusion !== "skipped");

    const issuesOut = await gh([
      "api",
      "graphql",
      "-f",
      `query=${GRAPHQL}`,
      "-f",
      `owner=${owner}`,
      "-f",
      `name=${name}`,
      "-f",
      `since=${new Date(week).toISOString()}`,
      ...AGENT_LABELS.flatMap((label) => ["-f", `labels[]=${label}`]),
    ]);
    // The Specs tab must not take the pipeline down with it: if its query fails, its lists are empty.
    let specs = EMPTY_SPECS;
    try {
      const specsOut = await gh([
        "api",
        "graphql",
        "-f",
        `query=${SPECS_GRAPHQL}`,
        "-f",
        `owner=${owner}`,
        "-f",
        `name=${name}`,
        ...WAITING_LABELS.flatMap((label) => ["-f", `waiting[]=${label}`]),
        ...FEATURE_LABELS.flatMap((label) => ["-f", `features[]=${label}`]),
      ]);
      specs = parseSpecs(JSON.parse(specsOut), options.now);
    } catch {
      // Left empty.
    }
    return {
      ok: true,
      repo,
      runners,
      runnersNote,
      runs,
      issues: parseIssues(JSON.parse(issuesOut), options.now),
      specs,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: message, repo };
  }
}

/** Dispatches `factory.yml` for an issue, as `issue-state.yml` does. */
export async function dispatchRun(gh: GhRunner, repo: string, issue: number): Promise<void> {
  await gh(["workflow", "run", "factory.yml", "--repo", repo, "-f", `issue=${issue}`]);
}
