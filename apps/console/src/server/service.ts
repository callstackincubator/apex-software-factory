import type { Source } from "../shared/schema.ts";
import type { Collected } from "./derive/deliveries.ts";
import { readGithub, type GhRunner, type GithubCache, newGithubCache } from "./github.ts";
import type { OpencodeDb } from "./opencode-db.ts";
import { readStops } from "./run-logs.ts";
import { readAutomations, type AutomationsRead } from "./workflows.ts";

export const REFRESH_MS = 10_000;

export interface Collector {
  /** The newest reading, refreshed at most every 10 s; concurrent callers share one refresh. */
  collect(): Promise<Collected>;
}

export interface CollectorDeps {
  now: () => number;
  gh: GhRunner;
  repo: string | undefined;
  db: OpencodeDb;
  runLogDirs: () => string[];
  ttlMs?: number;
}

/** Reads GitHub, the OpenCode database and the run logs, each optional (CONSOLE.md 1). */
export function createCollector(deps: CollectorDeps): Collector {
  const ttl = deps.ttlMs ?? REFRESH_MS;
  const cache: GithubCache = newGithubCache();
  let last: { at: number; value: Collected } | null = null;
  let inflight: Promise<Collected> | null = null;

  async function refresh(): Promise<Collected> {
    const now = deps.now();
    const github = await readGithub(deps.gh, { repo: deps.repo, now, cache });
    const gh: Collected["github"] = github.ok
      ? { source: { name: "github", status: "ok", refreshedAt: now }, data: github }
      : {
          source: {
            name: "github",
            status: "unavailable",
            reason: github.reason,
            refreshedAt: now,
          },
          data: null,
        };

    const read = deps.db.read();
    const opencode: Collected["opencode"] = read.ok
      ? { source: { name: "opencode", status: "ok", refreshedAt: now }, data: read.data }
      : {
          source: {
            name: "opencode",
            status: "unavailable",
            reason: read.reason,
            refreshedAt: now,
          },
          data: null,
        };

    const dirs = deps.runLogDirs();
    const runLogs: Collected["runLogs"] =
      dirs.length === 0
        ? {
            source: unavailable("runLogs", "no run-log directory found", now),
            stops: [],
          }
        : { source: { name: "runLogs", status: "ok", refreshedAt: now }, stops: readStops(dirs) };

    return { now, demo: false, repo: github.repo, github: gh, opencode, runLogs };
  }

  return {
    async collect() {
      if (last && deps.now() - last.at < ttl) return last.value;
      inflight ??= refresh()
        .then((value) => {
          last = { at: deps.now(), value };
          return value;
        })
        .finally(() => {
          inflight = null;
        });
      return inflight;
    },
  };
}

function unavailable(name: Source["name"], reason: string, at: number): Source {
  return { name, status: "unavailable", reason, refreshedAt: at };
}

export interface AutomationsCollector {
  collect(): Promise<AutomationsRead>;
}

/** The workflow files and GitHub's view of them, refreshed at most every 10 s, shared. */
export function createAutomationsCollector(deps: {
  now: () => number;
  gh: GhRunner;
  repo: string | undefined;
  workflowsDir: string;
  ttlMs?: number;
}): AutomationsCollector {
  const ttl = deps.ttlMs ?? REFRESH_MS;
  let last: { at: number; value: AutomationsRead } | null = null;
  let inflight: Promise<AutomationsRead> | null = null;
  return {
    async collect() {
      if (last && deps.now() - last.at < ttl) return last.value;
      inflight ??= readAutomations(deps.gh, {
        dir: deps.workflowsDir,
        repo: deps.repo,
        now: deps.now(),
      })
        .then((value) => {
          last = { at: deps.now(), value };
          return value;
        })
        .finally(() => {
          inflight = null;
        });
      return inflight;
    },
  };
}
