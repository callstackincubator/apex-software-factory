import { execFile } from "node:child_process";
import type { MemoryResponse } from "../shared/memory-schema.ts";
import type {
  MemoryCurated,
  MemoryLesson,
  MemoryRetro,
  MemoryRun,
} from "../shared/memory-schema.ts";
import { allowedMemoryPath, parseLesson, parseRetro, parseRun } from "./derive/memory.ts";

/**
 * The factory's memory branch, read-only (CONSOLE.md, Memory). Git is run with `execFile`, never a
 * shell, and only to fetch the one branch and to read it with plumbing: no checkout, no write,
 * no push. A path is read only when `ls-tree` listed it and it matches a strict pattern.
 */

/** Runs `git` with the arguments and returns its stdout. Injected, so tests stub it. */
export type GitRunner = (args: readonly string[]) => Promise<string>;

export class GitError extends Error {
  readonly stderr: string;
  constructor(args: readonly string[], stderr: string) {
    super(`git ${args.slice(0, 2).join(" ")} failed: ${stderr.trim() || "no output"}`);
    this.name = "GitError";
    this.stderr = stderr;
  }
}

export function gitRunner(cwd: string): GitRunner {
  return (args) =>
    new Promise((resolve, reject) => {
      execFile(
        "git",
        [...args],
        {
          cwd,
          maxBuffer: 8 * 1024 * 1024,
          timeout: 30_000,
          env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
        },
        (error, stdout, stderr) => {
          if (error) {
            const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
            reject(new GitError(args, missing ? "git is not on PATH" : String(stderr || "")));
          } else resolve(stdout);
        },
      );
    });
}

export const MEMORY_REFRESH_MS = 60_000;
export const BRANCH = "factory-memory";
const REF = `origin/${BRANCH}`;
/** A file is read up to this many characters. */
export const MAX_FILE = 200_000;
export const MAX_RUNS = 200;
export const MAX_LESSONS_PER_TOPIC = 50;
const MAX_RETROS = 50;
const MAX_CURATED = 20;
const PARALLEL = 8;

export interface MemorySource {
  /** The newest reading, refreshed at most every 60 s; concurrent callers share one refresh. */
  read(): Promise<MemoryResponse>;
  /** One file's text, or null when the path is not in the branch's tree (or not allowed). */
  file(path: string): Promise<string | null>;
}

export interface MemoryDeps {
  now: () => number;
  git: GitRunner;
  ttlMs?: number;
}

interface Cache {
  at: number;
  sha: string | null;
  response: MemoryResponse;
  /** Every allowed path in the tree, not only the capped ones read. */
  paths: ReadonlySet<string>;
}

const firstLine = (text: string): string => text.trim().split("\n")[0] ?? "";
const cap = (text: string): string => (text.length > MAX_FILE ? text.slice(0, MAX_FILE) : text);

async function pool<T, R>(items: readonly T[], run: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await run(items[i] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, items.length) }, worker));
  return out;
}

const emptyResponse = (
  now: number,
  status: MemoryResponse["status"],
  notes: string[],
  reason?: string,
): MemoryResponse => ({
  generatedAt: now,
  status,
  ...(reason === undefined ? {} : { reason }),
  notes,
  lastWrittenAt: null,
  counts: { lessons: 0, curated: 0, runs: 0, retros: 0 },
  lessons: [],
  curated: [],
  runs: [],
  retros: [],
});

export function createMemory(deps: MemoryDeps): MemorySource {
  const ttl = deps.ttlMs ?? MEMORY_REFRESH_MS;
  let cache: Cache | null = null;
  let inflight: Promise<Cache> | null = null;

  const show = async (path: string): Promise<string> =>
    cap(await deps.git(["show", `${REF}:${path}`]));

  async function refresh(): Promise<Cache> {
    const now = deps.now();
    const notes: string[] = [];
    let missing = false;
    let fetchFailure: string | null = null;
    try {
      await deps.git(["fetch", "--quiet", "origin", `+${BRANCH}:refs/remotes/${REF}`]);
    } catch (error) {
      const text = error instanceof GitError ? error.stderr : String(error);
      if (/couldn't find remote ref/i.test(text)) missing = true;
      else fetchFailure = firstLine(text) || "git fetch failed";
    }

    let sha: string | null = null;
    if (!missing) {
      try {
        sha = (await deps.git(["rev-parse", "--verify", "--quiet", REF])).trim() || null;
      } catch {
        sha = null;
      }
    }
    if (sha === null) {
      const response =
        fetchFailure === null
          ? emptyResponse(now, "empty", [])
          : emptyResponse(now, "unavailable", [], `could not fetch ${BRANCH}: ${fetchFailure}`);
      return { at: now, sha: null, response, paths: new Set() };
    }
    if (fetchFailure !== null)
      notes.push(`Could not refresh the branch (${fetchFailure}); showing the last fetch.`);
    if (cache?.sha === sha && cache.response.status === "ok") {
      return { ...cache, at: now, response: { ...cache.response, generatedAt: now, notes } };
    }

    let listing: string;
    try {
      listing = await deps.git(["ls-tree", "-r", "--name-only", REF]);
    } catch (error) {
      return {
        at: now,
        sha: null,
        response: emptyResponse(
          now,
          "unavailable",
          [],
          error instanceof Error ? firstLine(error.message) : String(error),
        ),
        paths: new Set(),
      };
    }
    const all = listing
      .split("\n")
      .map((l) => l.trim())
      .filter(allowedMemoryPath)
      .sort()
      .reverse();
    const under = (dir: string) => all.filter((p) => p.startsWith(`${dir}/`));
    const lessonPaths = under("lessons");
    const byTopic = new Map<string, string[]>();
    for (const p of lessonPaths) {
      const topic = p.split("/")[1] ?? "";
      byTopic.set(topic, [...(byTopic.get(topic) ?? []), p]);
    }
    const lessonRead = [...byTopic.values()].flatMap((p) => p.slice(0, MAX_LESSONS_PER_TOPIC));
    const curatedPaths = under("curated");
    const runPaths = under("runs");
    const retroPaths = under("retros");

    let unreadable = 0;
    const readAll = async <T>(paths: string[], parse: (path: string, text: string) => T | null) =>
      (
        await pool(paths, async (p) => {
          try {
            return parse(p, await show(p));
          } catch {
            unreadable += 1;
            return null;
          }
        })
      ).filter((x): x is T => x !== null);

    const lessons: MemoryLesson[] = await readAll(lessonRead, parseLesson);
    const curated: MemoryCurated[] = await readAll(
      curatedPaths.slice(0, MAX_CURATED),
      (path, markdown) => ({
        topic: (path.split("/").pop() ?? path).replace(/\.md$/, ""),
        path,
        markdown,
      }),
    );
    const runs: MemoryRun[] = await readAll(runPaths.slice(0, MAX_RUNS), parseRun);
    // Retros need only their heading, which is within the first lines.
    const retros: MemoryRetro[] = await readAll(retroPaths.slice(0, MAX_RETROS), parseRetro);

    let lastWrittenAt: number | null = null;
    try {
      const at = Date.parse((await deps.git(["log", "-1", "--format=%cI", REF])).trim());
      lastWrittenAt = Number.isNaN(at) ? null : at;
    } catch {
      lastWrittenAt = null;
    }
    if (unreadable > 0) notes.push(`${unreadable} files could not be read.`);

    const newestFirst = <T extends { date: number | null }>(a: T, b: T) =>
      (b.date ?? 0) - (a.date ?? 0);
    const response: MemoryResponse = {
      generatedAt: now,
      status: "ok",
      notes,
      lastWrittenAt,
      counts: {
        lessons: lessonPaths.length,
        curated: curatedPaths.length,
        runs: runPaths.length,
        retros: retroPaths.length,
      },
      lessons: lessons.sort(newestFirst),
      curated,
      runs: runs.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0)),
      retros,
    };
    return { at: now, sha, response, paths: new Set(all) };
  }

  async function current(): Promise<Cache> {
    if (cache !== null && deps.now() - cache.at < ttl) return cache;
    inflight ??= refresh()
      .then((next) => {
        cache = next;
        return next;
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  }

  return {
    read: async () => (await current()).response,
    async file(path) {
      if (!allowedMemoryPath(path)) return null;
      const { paths } = await current();
      if (!paths.has(path)) return null;
      return show(path);
    },
  };
}
