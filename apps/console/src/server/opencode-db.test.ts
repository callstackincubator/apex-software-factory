import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { agentOf, openOpencodeDb } from "./opencode-db.ts";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop() ?? "", { recursive: true, force: true });
});

// OpenCode v2.0.22's session tables, from packages/core/src/session/sql.ts (drizzle).
// json columns are TEXT; timestamps are epoch ms INTEGER.
const V2_DDL = `
CREATE TABLE \`session_v2\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`project_id\` text NOT NULL,
  \`workspace_id\` text,
  \`parent_id\` text,
  \`fork_session_id\` text,
  \`fork_boundary\` text,
  \`slug\` text NOT NULL,
  \`directory\` text NOT NULL,
  \`path\` text,
  \`title\` text,
  \`version\` text NOT NULL,
  \`share_url\` text,
  \`summary_additions\` integer,
  \`summary_deletions\` integer,
  \`summary_files\` integer,
  \`summary_diffs\` text,
  \`metadata\` text,
  \`cost\` real DEFAULT 0 NOT NULL,
  \`tokens_input\` integer DEFAULT 0 NOT NULL,
  \`tokens_output\` integer DEFAULT 0 NOT NULL,
  \`tokens_reasoning\` integer DEFAULT 0 NOT NULL,
  \`tokens_cache_read\` integer DEFAULT 0 NOT NULL,
  \`tokens_cache_write\` integer DEFAULT 0 NOT NULL,
  \`revert\` text,
  \`permission\` text,
  \`agent\` text,
  \`model\` text,
  \`time_created\` integer NOT NULL,
  \`time_updated\` integer NOT NULL,
  \`time_idle\` integer,
  \`time_viewed\` integer,
  \`idle_outcome\` text,
  \`time_compacting\` integer,
  \`time_archived\` integer,
  \`time_suspended\` integer,
  \`resume_attempts\` integer DEFAULT 0 NOT NULL
);
CREATE INDEX \`session_v2_parent_idx\` ON \`session_v2\` (\`parent_id\`);
CREATE TABLE \`session_message\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`session_id\` text NOT NULL REFERENCES \`session_v2\`(\`id\`) ON DELETE CASCADE,
  \`type\` text NOT NULL,
  \`seq\` integer NOT NULL,
  \`time_created\` integer NOT NULL,
  \`time_updated\` integer NOT NULL,
  \`data\` text NOT NULL
);
CREATE UNIQUE INDEX \`session_message_session_seq_idx\` ON \`session_message\` (\`session_id\`,\`seq\`);
`;

const REPORT = `Done.

PR: #9  Round: 1  Kind: code
Spec review: 1 findings (0 blocking)  Code review: 2 findings (1 blocking)
Fix: a.ts:1 broken
Nits: none
Rejected: none
Spec needs: none
Rerun: code`;

function makeDb(name: string, build: (db: DatabaseSync) => void): string {
  const dir = mkdtempSync(join(tmpdir(), "console-db-"));
  dirs.push(dir);
  const path = join(dir, name);
  const db = new DatabaseSync(path);
  build(db);
  db.close();
  return path;
}

interface Row {
  id: string;
  parent?: string;
  agent?: string;
  title?: string | null;
  created: number;
  updated: number;
  cost?: number;
  idle?: number;
  outcome?: string;
}

function insertSession(db: DatabaseSync, r: Row) {
  db.prepare(
    `INSERT INTO session_v2 (id, project_id, parent_id, slug, directory, title, version, cost, tokens_input, tokens_output, tokens_reasoning, agent, time_created, time_updated, time_idle, idle_outcome)
     VALUES (?, 'p', ?, ?, '/repo', ?, '2.0.22', ?, 100, 10, 5, ?, ?, ?, ?, ?)`,
  ).run(
    r.id,
    r.parent ?? null,
    r.id,
    r.title ?? null,
    r.cost ?? 0,
    r.agent ?? null,
    r.created,
    r.updated,
    r.idle ?? null,
    r.outcome ?? null,
  );
}

function message(
  db: DatabaseSync,
  id: string,
  session: string,
  type: string,
  seq: number,
  data: unknown,
) {
  db.prepare("INSERT INTO session_message VALUES (?, ?, ?, ?, 0, 0, ?)").run(
    id,
    session,
    type,
    seq,
    JSON.stringify(data),
  );
}

function populate(db: DatabaseSync) {
  db.exec(V2_DDL);
  insertSession(db, {
    id: "run1",
    agent: "factory",
    title: "factory deliver #42 (attempt 2)",
    created: 1_000,
    updated: 9_000,
    cost: 1.5,
    idle: 9_500,
    outcome: "succeeded",
  });
  insertSession(db, {
    id: "impl1",
    parent: "run1",
    agent: "implementer",
    title: "Implement",
    created: 2_000,
    updated: 4_000,
    cost: 0.5,
  });
  insertSession(db, {
    id: "ver1",
    parent: "run1",
    title: "Verify findings (@review-verifier subagent)",
    created: 5_000,
    updated: 6_000,
  });
  insertSession(db, {
    id: "chat",
    agent: "build",
    title: "Fix the leaderboard",
    created: 500,
    updated: 8_000,
    cost: 0.25,
  });
  insertSession(db, { id: "untitled", created: 400, updated: 7_000 });
  message(db, "m1", "ver1", "assistant", 1, {
    finish: "tool-calls",
    content: [{ type: "text", text: "looking" }],
  });
  message(db, "m2", "ver1", "assistant", 2, {
    finish: "stop",
    content: [
      { type: "tool", name: "x" },
      { type: "text", text: "Done." },
      { type: "reasoning", text: "hmm" },
      { type: "text", text: REPORT.replace("Done.\n\n", "") },
    ],
  });
}

describe("openOpencodeDb with OpenCode v2's tables", () => {
  const path = () => makeDb("v2.db", populate);

  it("finds the run by its title, with its issue, attempt, cost and tokens", () => {
    const result = openOpencodeDb(path()).read();

    if (!result.ok) throw new Error(result.reason);
    expect(result.data.runs).toHaveLength(1);
    expect(result.data.runs[0]).toMatchObject({
      id: "run1",
      mode: "deliver",
      issue: 42,
      attempt: 2,
      start: 1_000,
    });
    expect(result.data.runs[0]?.costUsd).toBeCloseTo(2.0);
    expect(result.data.runs[0]?.tokens).toEqual({ input: 300, output: 30, reasoning: 15 });
  });

  it("takes the run's end and outcome from time_idle and idle_outcome", () => {
    const result = openOpencodeDb(path()).read();

    if (!result.ok) throw new Error(result.reason);
    expect(result.data.runs[0]).toMatchObject({ end: 9_500, outcome: "succeeded" });
  });

  it("falls back to the last idle row when idle_outcome is empty, and to time_updated with none", () => {
    const withIdleRow = makeDb("idle.db", (db) => {
      db.exec(V2_DDL);
      insertSession(db, {
        id: "r1",
        agent: "factory",
        title: "factory triage #5 (attempt 1)",
        created: 100,
        updated: 900,
      });
      insertSession(db, {
        id: "r2",
        agent: "factory",
        title: "factory deliver #6 (attempt 1)",
        created: 100,
        updated: 800,
      });
      message(db, "i1", "r1", "idle", 1, { outcome: "failed", time: { created: 700 } });
      message(db, "i2", "r1", "idle", 2, { outcome: "interrupted", time: { created: 850 } });
    });

    const result = openOpencodeDb(withIdleRow).read();

    if (!result.ok) throw new Error(result.reason);
    const byIssue = Object.fromEntries(result.data.runs.map((r) => [r.issue, r]));
    expect(byIssue[5]).toMatchObject({ mode: "triage", outcome: "interrupted", end: 850 });
    expect(byIssue[6]).toMatchObject({ outcome: null, end: 800 });
  });

  it("finds the subagents by parent, naming one by its column and one by its title", () => {
    const result = openOpencodeDb(path()).read();

    if (!result.ok) throw new Error(result.reason);
    expect(result.data.runs[0]?.subagents.map((s) => [s.id, s.agent, s.start, s.end])).toEqual([
      ["impl1", "implementer", 2_000, 4_000],
      ["ver1", "review-verifier", 5_000, 6_000],
    ]);
  });

  it("reads the verifier's text from the text parts of its last assistant row, joined with a blank line", () => {
    const result = openOpencodeDb(path()).read();

    if (!result.ok) throw new Error(result.reason);
    const text = result.data.runs[0]?.subagents.find((s) => s.agent === "review-verifier")?.text;
    expect(text).toBe(`Done.\n\n${REPORT.replace("Done.\n\n", "")}`);
  });

  it("lists a top-level session with another title, or none, as interactive, newest first", () => {
    const result = openOpencodeDb(path()).read();

    if (!result.ok) throw new Error(result.reason);
    expect(
      result.data.interactive.map((s) => [s.id, s.title, s.agent, s.updatedAt, s.costUsd]),
    ).toEqual([
      ["chat", "Fix the leaderboard", "build", 8_000, 0.25],
      ["untitled", "untitled", null, 7_000, 0],
    ]);
  });

  it("never writes: the connection is read-only", () => {
    const file = path();
    openOpencodeDb(file).read();

    const probe = new DatabaseSync(file, { readOnly: true });
    expect(() => probe.exec("DELETE FROM session_v2")).toThrow();
    probe.close();
  });
});

describe("openOpencodeDb when the database cannot give what the console needs", () => {
  it("is unavailable, naming the column, when parent_id is missing", () => {
    const path = makeDb("bad.db", (db) => {
      db.exec(V2_DDL.replace("  `parent_id` text,\n", "").replace(/CREATE INDEX[^;]*;/, ""));
    });

    expect(openOpencodeDb(path).read()).toEqual({
      ok: false,
      reason: "session_v2 has no parent_id column",
    });
  });

  it("is unavailable, saying it is a 1.x database, when only a session table exists", () => {
    const path = makeDb("v1.db", (db) => {
      db.exec(
        "CREATE TABLE session (id TEXT, parent_id TEXT, agent TEXT, directory TEXT, time_created INTEGER, time_updated INTEGER, title TEXT)",
      );
    });

    const result = openOpencodeDb(path).read();

    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.reason).toMatch(
        /OpenCode 1\.x database \(it has a session table, not session_v2\)/,
      );
  });

  it("is unavailable when session_message is missing, and when it lacks a column", () => {
    const noTable = makeDb("a.db", (db) => db.exec("CREATE TABLE session_v2 (id TEXT)"));
    const noColumn = makeDb("b.db", (db) =>
      db.exec(
        V2_DDL.replace("  `seq` integer NOT NULL,\n", "").replace(/CREATE UNIQUE INDEX[^;]*;/, ""),
      ),
    );

    expect(openOpencodeDb(noTable).read()).toMatchObject({
      ok: false,
      reason: expect.stringContaining("no session_message table"),
    });
    expect(openOpencodeDb(noColumn).read()).toEqual({
      ok: false,
      reason: "session_message has no seq column",
    });
  });

  it("is unavailable when no session table exists at all", () => {
    const path = makeDb("empty.db", (db) => db.exec("CREATE TABLE other (id TEXT)"));

    const result = openOpencodeDb(path).read();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("no session_v2 table");
  });

  it("is unavailable when the file does not exist", () => {
    const result = openOpencodeDb(join(tmpdir(), "console-no-such-file.db")).read();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("database not found");
  });
});

describe("agentOf", () => {
  it("prefers the column and falls back to the @name in the title", () => {
    expect(agentOf("implementer", "x (@code-reviewer subagent)")).toBe("implementer");
    expect(agentOf(null, "Check (@code-reviewer subagent)")).toBe("code-reviewer");
    expect(agentOf("", "no agent here")).toBe("unknown");
  });
});
