import type {
  Automation,
  AutomationDetail,
  AutomationRun,
  AutomationsResponse,
} from "../../shared/schema.ts";
import type { AutomationsRead, WorkflowFile, WorkflowRun } from "../workflows.ts";
import { describeCron, nextRun, previousRun } from "./cron.ts";
import { median } from "./stats.ts";

/** A due scheduled time stays "due" for this long; after that the run is simply missing. */
const DUE_WINDOW_MS = 3 * 3_600_000;

export function runWord(run: Pick<WorkflowRun, "status" | "conclusion">): string {
  if (run.status === "completed") return run.conclusion ?? "unknown";
  return run.status;
}

const FAILED = new Set(["failure", "timed_out", "startup_failure"]);

function toRun(run: WorkflowRun): AutomationRun {
  const done = run.status === "completed";
  return {
    id: run.id,
    event: run.event,
    word: runWord(run),
    startedAt: run.startedAt,
    durationMs: done ? Math.max(0, run.updatedAt - run.startedAt) : null,
    url: run.url,
  };
}

/** Why Run now does not apply to the workflow, or null when it does (CONSOLE.md 3). */
export function dispatchRefusal(file: WorkflowFile, state: string): string | null {
  if (file.file === "factory.yml") {
    return "factory.yml is started from the Pipeline tab (it needs an issue)";
  }
  if (!file.events.includes("workflow_dispatch")) return "it has no workflow_dispatch trigger";
  const required = file.inputs.filter((i) => i.required);
  if (required.length > 0) {
    return `it needs ${required.length === 1 ? "an input" : "inputs"} (${required.map((i) => i.name).join(", ")}); start it from GitHub`;
  }
  if (state === "disabled_manually" || state === "disabled_inactivity")
    return "the workflow is disabled";
  return null;
}

function automation(
  read: AutomationsRead,
  file: WorkflowFile,
): { automation: Automation; runs: AutomationRun[] } {
  const now = read.now;
  const state = read.states.get(file.file) ?? "unknown";
  const raw = [...(read.runs.get(file.file) ?? [])].sort((a, b) => b.startedAt - a.startedAt);
  const runs = raw.map(toRun);
  const completed = runs.filter(
    (r) => !["in_progress", "queued", "waiting", "skipped", "cancelled"].includes(r.word),
  );
  const successes = completed.filter((r) => r.word === "success").length;
  const lastDone = runs.find((r) => !["in_progress", "queued", "waiting"].includes(r.word));
  const disabled = state === "disabled_manually" || state === "disabled_inactivity";
  const status: Automation["status"] = disabled
    ? "disabled"
    : lastDone && FAILED.has(lastDone.word)
      ? "failing"
      : "healthy";

  const nexts = file.crons.map((c) => nextRun(c, now)).filter((t): t is number => t !== null);
  const next = disabled || nexts.length === 0 ? null : Math.min(...nexts);
  let dueSince: number | null = null;
  if (!disabled && read.states.size > 0) {
    for (const cron of file.crons) {
      const tick = previousRun(cron, now);
      if (tick === null || now - tick > DUE_WINDOW_MS || now - tick < 60_000) continue;
      const ran = raw.some((r) => r.event === "schedule" && r.startedAt >= tick - 60_000);
      if (!ran && (dueSince === null || tick > dueSince)) dueSince = tick;
    }
  }
  const refusal = dispatchRefusal(file, state);
  return {
    runs,
    automation: {
      file: file.file,
      name: file.name,
      description: file.description,
      url:
        read.repo === null
          ? null
          : `https://github.com/${read.repo}/actions/workflows/${file.file}`,
      events: file.events,
      crons: file.crons,
      schedule: file.crons.map((cron) => ({ cron, words: describeCron(cron) })),
      nextRun: next,
      dueSince,
      state,
      status,
      lastRun: runs[0] ?? null,
      successRate: completed.length === 0 ? null : successes / completed.length,
      medianMs: median(runs.map((r) => r.durationMs).filter((d): d is number => d !== null)),
      inputs: file.inputs,
      runsOn: file.runsOn,
      selfHosted: file.selfHosted,
      dispatchable: refusal === null,
      dispatchRefusal: refusal,
    },
  };
}

/** Every workflow: scheduled ones first by next run (a due one first), then the rest by name. */
export function buildAutomations(read: AutomationsRead): AutomationsResponse {
  const all = read.files.map((f) => automation(read, f).automation);
  const scheduled = all
    .filter((a) => a.crons.length > 0)
    .sort(
      (a, b) =>
        (a.dueSince === null ? 1 : 0) - (b.dueSince === null ? 1 : 0) ||
        (a.nextRun ?? Infinity) - (b.nextRun ?? Infinity) ||
        a.name.localeCompare(b.name),
    );
  const rest = all.filter((a) => a.crons.length === 0).sort((a, b) => a.name.localeCompare(b.name));
  return {
    generatedAt: read.now,
    repo: read.repo,
    notes: read.notes,
    automations: [...scheduled, ...rest],
  };
}

export function buildAutomationDetail(
  read: AutomationsRead,
  file: string,
): AutomationDetail | null {
  const found = read.files.find((f) => f.file === file);
  if (!found) return null;
  const { automation: a, runs } = automation(read, found);
  return { generatedAt: read.now, automation: a, runs: runs.slice(0, 20) };
}
