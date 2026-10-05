import { type GitRunner, GitError } from "./memory.ts";

/**
 * Demo memory (`CONSOLE_DEMO`): a virtual `factory-memory` tree served by a fake git, so the demo
 * goes through the same listing and parsing as the real branch. Issues are the demo snapshot's.
 */

const HOUR = 3_600_000;
const pad = (n: number) => String(n).padStart(2, "0");
const iso = (at: number) => new Date(at).toISOString().replace(/\.\d+Z$/, "Z");
const stamp = (at: number) => iso(at).replace(/[-:]/g, "").replace("T", "-").replace("Z", "");
const month = (at: number) => iso(at).slice(0, 7);

export function demoMemoryFiles(now: number): ReadonlyMap<string, string> {
  const files = new Map<string, string>();
  const lesson = (topic: string, ago: number, by: string, issue: number | null, text: string) => {
    const at = now - ago;
    files.set(
      `lessons/${topic}/${stamp(at)}-${(Math.abs(Math.floor(at / 1000)) % 36 ** 4).toString(36).padStart(4, "0")}.md`,
      [
        `topic: ${topic}`,
        `by: ${by}`,
        ...(issue === null ? [] : [`issue: ${issue}`]),
        `date: ${iso(at)}`,
        "code: 5b7ac41",
        "",
        text,
        "",
      ].join("\n"),
    );
  };
  lesson(
    "implement",
    5 * HOUR,
    "implementer",
    38,
    "Run `pnpm --filter @apex/mobile test -- --watchAll=false` for one package; the root `pnpm check` takes four minutes.",
  );
  lesson(
    "implement",
    31 * HOUR,
    "implementer",
    33,
    "A new zod field in `packages/contract` needs `pnpm --filter @apex/contract build` before the API typechecks.",
  );
  lesson(
    "implement",
    52 * HOUR,
    "implementer",
    34,
    "Jest in `apps/mobile` needs `jest.useFakeTimers()` for anything that animates; the default timers hang the suite.",
  );
  lesson(
    "device",
    6 * HOUR,
    "mobile-verifier",
    38,
    "`device-lane.sh` reuses the cached native build only when `native-check.sh` says JS-only; check that first instead of rebuilding.",
  );
  lesson(
    "device",
    29 * HOUR,
    "mobile-verifier",
    37,
    "After `agent-device` reports a stale snapshot, take a new one before tapping; refs from the old tree point at the wrong view.",
  );
  lesson(
    "ota",
    8 * HOUR,
    "ota-verifier",
    38,
    "The OTA check passes only after the simulator was relaunched twice: the first launch downloads, the second applies.",
  );
  lesson(
    "triage",
    27 * HOUR,
    "triager",
    34,
    "A bug that only shows on a cold start reproduces with `device-lane.sh --fresh`, not on a warm simulator.",
  );
  lesson(
    "deliver",
    4 * HOUR,
    "factory",
    38,
    "Park a native change at once; running the reviews first costs about ten minutes and the result cannot ship.",
  );
  lesson(
    "deliver",
    30 * HOUR,
    "factory",
    33,
    "Close a small spec gap as an `Assumption:` line in the PR instead of stopping; the reviewers accept it.",
  );

  files.set(
    "curated/implement.md",
    [
      "# implement",
      "",
      "- Run one package's tests with `pnpm --filter <package> test`; the root `pnpm check` is for the end.",
      "- A contract change comes first and needs a build of `@apex/contract` before anything imports it.",
      "- Animated components need fake timers in their Jest tests.",
      "",
    ].join("\n"),
  );

  const run = (
    ago: number,
    mode: string,
    issue: number,
    attempt: number,
    ended: string,
    time: string,
  ) => {
    const at = now - ago;
    files.set(
      `runs/${month(at)}/${stamp(at)}-${mode}-${issue}-a${attempt}.md`,
      [
        `# Run: ${mode} #${issue}, attempt ${attempt}`,
        "",
        `- Started: ${iso(at).slice(0, 10)} ${pad(new Date(at).getUTCHours())}:${pad(new Date(at).getUTCMinutes())}:${pad(new Date(at).getUTCSeconds())} UTC`,
        `- Ended: ${ended}`,
        "- Factory code: main at 5b7ac41; model callstack.ai/callstack/Apex",
        "- Started by hand on booth-mac; log `.worktrees/factory-runs/log` there",
        "",
        "## Stages",
        "",
        "| Agent | Start | Time | Steps | Finish | Outcome | Output tok | Reasoning tok | Peak prompt tok | Task |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
        `| factory | +0:00 | ${time} | 61/120 | stop 61 | idle | 9120 | 4410 | 88200 | deliver #${issue} |`,
        "| implementer | +1:12 | 9:40 | 44/80 | stop 44 | idle | 6120 | 2210 | 61200 | implement #" +
          issue +
          " |",
        "| code-reviewer | +11:30 | 3:05 | 12/40 | stop 12 | idle | 1800 | 900 | 40200 | review |",
        "",
        "## Tool calls",
        "",
        "- factory: bash 31, read 12, task 4",
        "- implementer: bash 22, edit 14, read 9",
        "",
        "## Journal",
        "",
        `- 12:41:03 implementer: the contract build was missing, cost two steps`,
        "",
      ].join("\n"),
    );
  };
  run(2 * HOUR, "deliver", 38, 1, "on its own (the issue and the PR say how)", "14:52");
  run(26 * HOUR, "deliver", 37, 1, "stopped: no progress for 15 min", "15:00");
  run(25 * HOUR, "deliver", 37, 2, "on its own (the issue and the PR say how)", "21:18");
  run(29 * HOUR, "deliver", 33, 1, "on its own (the issue and the PR say how)", "18:07");
  run(33 * HOUR, "triage", 34, 1, "on its own (the issue and the PR say how)", "6:31");

  const retroAt = now - 20 * HOUR;
  files.set(
    `retros/${iso(retroAt).slice(0, 10)}.md`,
    [
      "# Retro: five runs, two lost to the watchdog",
      "",
      "Five attempts since the last retro, four merged, one stopped for no progress.",
      "",
      "## Proposals",
      "",
      "1. **Tell the implementer to build the contract first** (`.agents/skills/implement/SKILL.md`). Saved about two steps in #33 and #38, evidence in both digests.",
      "2. **Park native changes before the reviews** (`.agents/skills/deliver/SKILL.md`). #37 spent ten minutes reviewing a change that could not ship.",
      "",
    ].join("\n"),
  );
  return files;
}

/** A fake `git` over the demo tree: the five commands the memory source runs. */
export function demoGit(now: () => number = Date.now): GitRunner {
  const sha = "d3m0".repeat(10);
  // Fixed when the console starts, so a path listed is the path read.
  const started = now();
  const files = demoMemoryFiles(started);
  return async (args) => {
    const [cmd] = args;
    if (cmd === "fetch") return "";
    if (cmd === "rev-parse") return `${sha}\n`;
    if (cmd === "ls-tree") return [...files.keys()].join("\n") + "\n";
    if (cmd === "log") return `${iso(started - 2 * HOUR)}\n`;
    if (cmd === "show") {
      const content = files.get((args[1] ?? "").replace(/^origin\/factory-memory:/, ""));
      if (content === undefined) throw new GitError(args, "path does not exist");
      return content;
    }
    throw new GitError(args, `demo git does not run ${cmd}`);
  };
}
