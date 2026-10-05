import { describe, expect, it } from "vitest";
import { allowedMemoryPath, parseRun } from "./derive/memory.ts";
import { demoGit } from "./memory-demo.ts";
import { createMemory, GitError, type GitRunner } from "./memory.ts";
import { NOW } from "./test-support.ts";

const SHA = "a".repeat(40);

/** A stub git over a tree of files; records every call. */
function stub(files: Record<string, string>, over: Partial<Record<string, () => string>> = {}) {
  const calls: string[][] = [];
  const git: GitRunner = async (args) => {
    calls.push([...args]);
    const handler = over[args[0] ?? ""];
    if (handler) return handler();
    switch (args[0]) {
      case "fetch":
        return "";
      case "rev-parse":
        return `${SHA}\n`;
      case "ls-tree":
        return Object.keys(files).join("\n") + "\n";
      case "log":
        return "2026-10-07T11:00:00+00:00\n";
      case "show": {
        const path = (args[1] ?? "").replace("origin/factory-memory:", "");
        const content = files[path];
        if (content === undefined) throw new GitError(args, "path does not exist");
        return content;
      }
      default:
        throw new GitError(args, "unexpected");
    }
  };
  return { git, calls };
}

// The format run-record.sh writes.
const DIGEST = [
  "# Run: deliver #42, attempt 2",
  "",
  "- Started: 2026-10-07 09:30:15 UTC",
  "- Ended: stopped: no progress for 15 min",
  "- Factory code: main at abc1234; model x",
  "",
  "## Stages",
  "",
  "| Agent | Start | Time | Steps | Finish | Outcome | Output tok | Reasoning tok | Peak prompt tok | Task |",
  "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  "| factory | +0:00 | 12:05 | 40/120 | stop 40 | idle | 1 | 2 | 3 | deliver |",
  "",
].join("\n");

const LESSON =
  "topic: implement\nby: implementer\nissue: 7\ndate: 2026-10-07T08:00:00Z\ncode: abc\n\nRun `pnpm check` last.\n";

describe("the memory source", () => {
  it("treats a missing remote branch as no memory yet, not an error", async () => {
    const { git, calls } = stub(
      {},
      {
        fetch: () => {
          throw new GitError(["fetch"], "fatal: couldn't find remote ref factory-memory");
        },
      },
    );
    const read = await createMemory({ now: () => NOW, git }).read();

    expect(read.status).toBe("empty");
    expect(read.notes).toEqual([]);
    expect(calls.map((c) => c[0])).toEqual(["fetch"]);
  });

  it("is unavailable, with the reason, when git cannot fetch and has nothing", async () => {
    const { git } = stub(
      {},
      {
        fetch: () => {
          throw new GitError(["fetch"], "fatal: unable to access");
        },
        "rev-parse": () => {
          throw new GitError(["rev-parse"], "");
        },
      },
    );
    const read = await createMemory({ now: () => NOW, git }).read();
    expect(read.status).toBe("unavailable");
    expect(read.reason).toContain("unable to access");
  });

  it("reads lessons, curated files, run digests and retros with plumbing only", async () => {
    const { git, calls } = stub({
      "lessons/implement/20261007-080000-ab12.md": LESSON,
      "curated/implement.md": "# implement\n\n- one\n",
      "runs/2026-10/20261007-093015-deliver-42-a2.md": DIGEST,
      "retros/2026-10-08.md": "# Retro: a title\n\nbody\n",
      "README.md": "ignored",
    });
    const read = await createMemory({ now: () => NOW, git }).read();

    expect(read.status).toBe("ok");
    expect(read.counts).toEqual({ lessons: 1, curated: 1, runs: 1, retros: 1 });
    expect(read.lessons[0]).toMatchObject({
      topic: "implement",
      issue: 7,
      text: "Run `pnpm check` last.",
    });
    expect(read.runs[0]).toMatchObject({
      issue: 42,
      attempt: 2,
      mode: "deliver",
      outcome: "stopped",
      reason: "no progress for 15 min",
      durationMs: (12 * 60 + 5) * 1000,
      startedAt: Date.UTC(2026, 9, 7, 9, 30, 15),
    });
    expect(read.retros[0]).toMatchObject({ date: "2026-10-08", title: "Retro: a title" });
    expect(read.lastWrittenAt).toBe(Date.parse("2026-10-07T11:00:00Z"));
    const verbs = new Set(calls.map((c) => c[0]));
    expect([...verbs].sort()).toEqual(["fetch", "log", "ls-tree", "rev-parse", "show"]);
    expect(calls.some((c) => c.includes("README.md") || c.join(" ").includes("README"))).toBe(
      false,
    );
  });

  it("never reads a path outside the allowed pattern, or with `..`", async () => {
    const { git, calls } = stub({
      "lessons/../secrets.md": "x",
      "lessons/implement/a b.md": "x",
      "archive/lessons/implement/old.md": "x",
      "runs/2026-10/ok.md": "# Run: deliver #1, attempt 1\n",
      "curated/..hidden.md": "x",
    });
    const memory = createMemory({ now: () => NOW, git });
    const read = await memory.read();

    const shown = calls.filter((c) => c[0] === "show").map((c) => c[1]);
    expect(shown).toEqual(["origin/factory-memory:runs/2026-10/ok.md"]);
    expect(read.counts.runs).toBe(1);
    await expect(memory.file("lessons/../secrets.md")).resolves.toBeNull();
    await expect(memory.file("curated/implement.md")).resolves.toBeNull();
    expect(allowedMemoryPath("runs/../x.md")).toBe(false);
    expect(allowedMemoryPath("runs/2026-10/x.md")).toBe(true);
    expect(allowedMemoryPath("../runs/x.md")).toBe(false);
  });

  it("fetches at most once per refresh window", async () => {
    let now = NOW;
    const { git, calls } = stub({ "runs/2026-10/ok.md": "# Run: deliver #1, attempt 1\n" });
    const memory = createMemory({ now: () => now, git });
    await memory.read();
    await memory.read();
    now += 61_000;
    await memory.read();
    expect(calls.filter((c) => c[0] === "fetch")).toHaveLength(2);
    // The branch did not move, so the second refresh does not read the tree again.
    expect(calls.filter((c) => c[0] === "ls-tree")).toHaveLength(1);
  });

  it("returns a listed file's text and nothing for a path not in the tree", async () => {
    const { git } = stub({ "retros/2026-10-08.md": "# Retro\n" });
    const memory = createMemory({ now: () => NOW, git });
    await expect(memory.file("retros/2026-10-08.md")).resolves.toBe("# Retro\n");
    await expect(memory.file("retros/2026-10-09.md")).resolves.toBeNull();
  });

  it("caps the lessons read per topic at the newest 50", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 60; i++) {
      files[`lessons/ota/20261007-08${String(i).padStart(2, "0")}00-aaaa.md`] = `lesson ${i}`;
    }
    const { git } = stub(files);
    const read = await createMemory({ now: () => NOW, git }).read();
    expect(read.counts.lessons).toBe(60);
    expect(read.lessons).toHaveLength(50);
  });
});

describe("a run digest", () => {
  it("parses issue, attempt and outcome in run-record.sh's format", () => {
    expect(
      parseRun(
        "runs/2026-10/20261007-093015-deliver-42-a1.md",
        DIGEST.replace(
          "stopped: no progress for 15 min",
          "on its own (the issue and the PR say how)",
        ),
      ),
    ).toMatchObject({ issue: 42, outcome: "finished", reason: null });
  });

  it("falls back to the file name when the content is odd", () => {
    expect(parseRun("runs/2026-10/20261007-093015-triage-9-a3.md", "garbage")).toMatchObject({
      issue: 9,
      attempt: 3,
      mode: "triage",
      outcome: "unknown",
      startedAt: Date.UTC(2026, 9, 7, 9, 30, 15),
    });
  });
});

describe("the demo memory", () => {
  it("goes through the same reading as the real branch", async () => {
    const read = await createMemory({ now: () => NOW, git: demoGit(() => NOW) }).read();
    expect(read.status).toBe("ok");
    expect(read.lessons.length).toBeGreaterThan(5);
    expect(read.curated).toHaveLength(1);
    expect(read.runs.map((r) => r.issue)).toContain(37);
    expect(read.runs.some((r) => r.outcome === "stopped")).toBe(true);
    expect(read.retros).toHaveLength(1);
  });
});
