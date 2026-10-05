import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { GhError, resolveRepo, type GhRunner } from "./github.ts";
import type { WorkflowInput } from "../shared/schema.ts";

export interface WorkflowFile {
  file: string;
  name: string;
  description: string;
  events: string[];
  crons: string[];
  inputs: WorkflowInput[];
  runsOn: string[];
  selfHosted: boolean;
}

const asRecord = (v: unknown): Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** The file's first comment block, without the `#`, up to the first blank or non-comment line. */
export function leadingComment(source: string): string {
  const lines = source.split(/\r?\n/);
  const block: string[] = [];
  let started = false;
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith("#")) {
      started = true;
      block.push(t.replace(/^#\s?/, ""));
    } else if (started) {
      break;
    }
  }
  return block.join("\n").trim();
}

function labels(runsOn: unknown): string[] {
  if (typeof runsOn === "string") return [runsOn];
  if (Array.isArray(runsOn)) return runsOn.filter((x): x is string => typeof x === "string");
  const group = asRecord(runsOn);
  const l = group["labels"];
  return Array.isArray(l) ? l.filter((x): x is string => typeof x === "string") : [];
}

/** One workflow file's facts (CONSOLE.md 1.4); null when it is not valid YAML. */
export function parseWorkflow(file: string, source: string): WorkflowFile | null {
  let doc: Record<string, unknown>;
  try {
    doc = asRecord(parse(source));
  } catch {
    return null;
  }
  // YAML 1.1 readers turn the key `on` into `true`; the yaml package keeps it, but be safe.
  const on = doc["on"] ?? doc["true"];
  const events: string[] = [];
  const crons: string[] = [];
  const inputs: WorkflowInput[] = [];
  if (typeof on === "string") events.push(on);
  else if (Array.isArray(on)) events.push(...on.filter((e): e is string => typeof e === "string"));
  else {
    const triggers = asRecord(on);
    events.push(...Object.keys(triggers));
    const schedule = triggers["schedule"];
    if (Array.isArray(schedule)) {
      for (const entry of schedule) {
        const cron = asRecord(entry)["cron"];
        if (typeof cron === "string") crons.push(cron);
      }
    }
    const dispatch = asRecord(triggers["workflow_dispatch"]);
    for (const [name, spec] of Object.entries(asRecord(dispatch["inputs"]))) {
      const s = asRecord(spec);
      inputs.push({
        name,
        required: s["required"] === true && s["default"] === undefined,
        description: typeof s["description"] === "string" ? s["description"] : "",
      });
    }
  }
  const runsOn = [
    ...new Set(
      Object.values(asRecord(doc["jobs"])).flatMap((job) => labels(asRecord(job)["runs-on"])),
    ),
  ];
  return {
    file,
    name: typeof doc["name"] === "string" ? doc["name"] : file,
    description: leadingComment(source),
    events,
    crons,
    inputs,
    runsOn,
    selfHosted: runsOn.includes("self-hosted"),
  };
}

/** Every workflow in the directory; one that cannot be read is left out. */
export function readWorkflowFiles(dir: string): { files: WorkflowFile[]; note: string | null } {
  let names: string[];
  try {
    names = readdirSync(dir).filter((n) => /\.ya?ml$/.test(n));
  } catch {
    return { files: [], note: `no workflow directory at ${dir}` };
  }
  const files: WorkflowFile[] = [];
  for (const name of names.sort()) {
    try {
      const parsed = parseWorkflow(name, readFileSync(join(dir, name), "utf8"));
      if (parsed) files.push(parsed);
    } catch {
      // Unreadable: not listed.
    }
  }
  return { files, note: null };
}

export interface WorkflowRun {
  id: number;
  event: string;
  status: string;
  conclusion: string | null;
  startedAt: number;
  updatedAt: number;
  url: string;
}

export interface AutomationsRead {
  now: number;
  repo: string | null;
  files: WorkflowFile[];
  /** GitHub's state per file name; empty when GitHub could not be read. */
  states: Map<string, string>;
  runs: Map<string, WorkflowRun[]>;
  notes: string[];
}

const time = (v: unknown): number | null => {
  const t = typeof v === "string" ? Date.parse(v) : Number.NaN;
  return Number.isNaN(t) ? null : t;
};

/** The workflow files plus GitHub's state and last 20 runs for each (CONSOLE.md 1.4). */
export async function readAutomations(
  gh: GhRunner,
  options: { dir: string; repo: string | undefined; now: number },
): Promise<AutomationsRead> {
  const { files, note } = readWorkflowFiles(options.dir);
  const read: AutomationsRead = {
    now: options.now,
    repo: options.repo ?? null,
    files,
    states: new Map(),
    runs: new Map(),
    notes: note === null ? [] : [note],
  };
  try {
    const repo = await resolveRepo(gh, options.repo);
    read.repo = repo;
    const list = JSON.parse(await gh(["api", `repos/${repo}/actions/workflows?per_page=100`])) as {
      workflows?: { path?: string; state?: string }[];
    };
    for (const w of list.workflows ?? []) {
      const file = (w.path ?? "").split("/").pop() ?? "";
      if (file !== "") read.states.set(file, w.state ?? "active");
    }
    await Promise.all(
      files
        .filter((f) => read.states.has(f.file))
        .map(async (f) => {
          const data = JSON.parse(
            await gh(["api", `repos/${repo}/actions/workflows/${f.file}/runs?per_page=20`]),
          ) as { workflow_runs?: Record<string, unknown>[] };
          read.runs.set(
            f.file,
            (data.workflow_runs ?? []).map((r) => ({
              id: Number(r["id"]),
              event: String(r["event"] ?? ""),
              status: String(r["status"] ?? ""),
              conclusion: typeof r["conclusion"] === "string" ? r["conclusion"] : null,
              startedAt: time(r["run_started_at"]) ?? time(r["created_at"]) ?? options.now,
              updatedAt: time(r["updated_at"]) ?? options.now,
              url: String(r["html_url"] ?? ""),
            })),
          );
        }),
    );
  } catch (error) {
    read.notes.push(
      `GitHub: ${error instanceof GhError || error instanceof Error ? error.message : String(error)}`,
    );
  }
  return read;
}

/** The repository's default branch, for `gh workflow run --ref`. */
export async function defaultBranch(gh: GhRunner, repo: string): Promise<string> {
  const out = (await gh(["api", `repos/${repo}`, "-q", ".default_branch"])).trim();
  if (out === "") throw new GhError(["api", repo], "no default branch");
  return out;
}

export async function dispatchWorkflow(gh: GhRunner, repo: string, file: string): Promise<void> {
  const branch = await defaultBranch(gh, repo);
  await gh(["workflow", "run", file, "--repo", repo, "--ref", branch]);
}
