import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { InteractiveSession } from "../shared/schema.ts";

export interface Subagent {
  id: string;
  agent: string;
  start: number;
  end: number;
  /** The final text of a `review-verifier`; empty for every other agent. */
  text: string | null;
}

export interface RunRecord {
  id: string;
  mode: "deliver" | "triage";
  issue: number;
  attempt: number;
  start: number;
  /** `time_idle` when the run went idle, else its last write. */
  end: number;
  /** `succeeded`, `failed` or `interrupted`; null while the run has not gone idle. */
  outcome: string | null;
  costUsd: number | null;
  tokens: { input: number; output: number; reasoning: number } | null;
  subagents: Subagent[];
}

export interface OpencodeData {
  runs: RunRecord[];
  interactive: InteractiveSession[];
}

export type OpencodeRead = { ok: true; data: OpencodeData } | { ok: false; reason: string };

export interface OpencodeDb {
  read(): OpencodeRead;
  close(): void;
}

const REQUIRED = ["id", "parent_id", "title", "agent", "directory", "time_created", "time_updated"];
const MESSAGE_REQUIRED = ["session_id", "type", "seq", "data"];
const OPTIONAL = [
  "cost",
  "tokens_input",
  "tokens_output",
  "tokens_reasoning",
  "time_idle",
  "idle_outcome",
];
const RUN_TITLE = /^factory (deliver|triage) #(\d+) \(attempt (\d+)\)$/;
const VERIFIER = "review-verifier";

type Row = Record<string, unknown>;

const num = (v: unknown): number => (typeof v === "number" ? v : Number(v ?? 0));
const numOrNull = (v: unknown): number | null =>
  v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** The agent of a subagent session: its column, else the `@name` in its title. */
export function agentOf(agent: unknown, title: unknown): string {
  const column = str(agent).trim();
  if (column !== "") return column;
  const at = /@([\w-]+)/.exec(str(title));
  return at?.[1] ?? "unknown";
}

interface Schema {
  table: string;
  columns: Set<string>;
  tables: Set<string>;
}

function detect(
  db: DatabaseSync,
  path: string,
): { ok: true; schema: Schema } | { ok: false; reason: string } {
  const tables = new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Row[]).map((r) =>
      str(r["name"]),
    ),
  );
  if (!tables.has("session_v2")) {
    return {
      ok: false,
      reason: tables.has("session")
        ? `${path} is an OpenCode 1.x database (it has a session table, not session_v2); the console reads OpenCode v2`
        : `no session_v2 table in ${path}`,
    };
  }
  if (!tables.has("session_message"))
    return { ok: false, reason: `no session_message table in ${path}` };
  const columnsOf = (table: string) =>
    new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Row[]).map((r) => str(r["name"])));
  const columns = columnsOf("session_v2");
  const missing = REQUIRED.filter((c) => !columns.has(c));
  if (missing.length > 0)
    return { ok: false, reason: `session_v2 has no ${missing.join(", ")} column` };
  const messageColumns = columnsOf("session_message");
  const messageMissing = MESSAGE_REQUIRED.filter((c) => !messageColumns.has(c));
  if (messageMissing.length > 0) {
    return { ok: false, reason: `session_message has no ${messageMissing.join(", ")} column` };
  }
  return { ok: true, schema: { table: "session_v2", columns, tables } };
}

function finalText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter((c): c is { type: string; text: string } => {
      return typeof c === "object" && c !== null && (c as Row)["type"] === "text";
    })
    .map((c) => str(c.text))
    .join("\n\n")
    .trim();
}

function parseJson(data: unknown): Row {
  try {
    const value: unknown = JSON.parse(str(data));
    return typeof value === "object" && value !== null ? (value as Row) : {};
  } catch {
    return {};
  }
}

/**
 * OpenCode's SQLite database, read-only (CONSOLE.md 1.2). It is opened on the first read and
 * kept open; every `read()` queries it afresh. A missing file, table or column is
 * `{ ok: false, reason }`, never a throw.
 */
export function openOpencodeDb(path: string): OpencodeDb {
  let db: DatabaseSync | null = null;
  let schema: Schema | null = null;
  const textCache = new Map<string, { updated: number; text: string | null }>();

  function open(): { ok: true } | { ok: false; reason: string } {
    if (db !== null && schema !== null) return { ok: true };
    if (!existsSync(path)) return { ok: false, reason: `database not found at ${path}` };
    try {
      const handle = new DatabaseSync(path, { readOnly: true });
      const found = detect(handle, path);
      if (!found.ok) {
        handle.close();
        return found;
      }
      db = handle;
      schema = found.schema;
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: `cannot open ${path}: ${(error as Error).message}` };
    }
  }

  function verifierText(sessionId: string, updated: number): string | null {
    const cached = textCache.get(sessionId);
    if (cached && cached.updated === updated) return cached.text;
    const text = queryText(sessionId);
    textCache.set(sessionId, { updated, text });
    return text;
  }

  function queryText(sessionId: string): string | null {
    if (db === null) return null;
    const rows = db
      .prepare(
        "SELECT data FROM session_message WHERE session_id = ? AND type = 'assistant' ORDER BY seq DESC LIMIT 1",
      )
      .all(sessionId) as Row[];
    const row = rows[0];
    return row ? finalText(parseJson(row["data"])["content"]) : null;
  }

  /** The last `idle` row of a session: where a run's outcome is read when the column is not. */
  function lastIdle(sessionId: string): { outcome: string; at: number | null } | null {
    if (db === null) return null;
    const row = (
      db
        .prepare(
          "SELECT data FROM session_message WHERE session_id = ? AND type = 'idle' ORDER BY seq DESC LIMIT 1",
        )
        .all(sessionId) as Row[]
    )[0];
    if (!row) return null;
    const data = parseJson(row["data"]);
    const outcome = str(data["outcome"]);
    if (outcome === "") return null;
    const time = data["time"];
    const created =
      typeof time === "object" && time !== null ? numOrNull((time as Row)["created"]) : null;
    return { outcome, at: created };
  }

  function read(): OpencodeRead {
    const opened = open();
    if (!opened.ok) return opened;
    if (db === null || schema === null) return { ok: false, reason: "database is not open" };
    try {
      const wanted = [...REQUIRED, ...OPTIONAL.filter((c) => schema?.columns.has(c))];
      const select = wanted.map((c) => c).join(", ");
      const top = db
        .prepare(
          `SELECT ${select} FROM ${schema.table} WHERE parent_id IS NULL ORDER BY time_created DESC LIMIT 5000`,
        )
        .all() as Row[];
      const children = db
        .prepare(
          `SELECT ${select} FROM ${schema.table} WHERE parent_id IS NOT NULL ORDER BY time_created ASC`,
        )
        .all() as Row[];

      const hasCost = schema.columns.has("cost");
      const hasTokens = schema.columns.has("tokens_input");
      const costOf = (rows: Row[]) =>
        hasCost && rows.length > 0 ? rows.reduce((n, r) => n + num(r["cost"]), 0) : null;
      const tokensOf = (rows: Row[]) =>
        hasTokens
          ? {
              input: rows.reduce((n, r) => n + num(r["tokens_input"]), 0),
              output: rows.reduce((n, r) => n + num(r["tokens_output"]), 0),
              reasoning: rows.reduce((n, r) => n + num(r["tokens_reasoning"]), 0),
            }
          : null;

      const byParent = new Map<string, Row[]>();
      for (const child of children) {
        const list = byParent.get(str(child["parent_id"])) ?? [];
        list.push(child);
        byParent.set(str(child["parent_id"]), list);
      }

      const runs: RunRecord[] = [];
      const interactive: InteractiveSession[] = [];
      for (const row of top) {
        const title = str(row["title"]);
        const match = RUN_TITLE.exec(title);
        if (!match) {
          interactive.push({
            id: str(row["id"]),
            title: title === "" ? str(row["agent"]) || "untitled" : title,
            agent: str(row["agent"]) === "" ? null : str(row["agent"]),
            directory: str(row["directory"]),
            updatedAt: num(row["time_updated"]),
            costUsd: hasCost ? numOrNull(row["cost"]) : null,
          });
          continue;
        }
        const kids = byParent.get(str(row["id"])) ?? [];
        const subagents: Subagent[] = kids.map((kid) => {
          const agent = agentOf(kid["agent"], kid["title"]);
          const end = num(kid["time_updated"]);
          return {
            id: str(kid["id"]),
            agent,
            start: num(kid["time_created"]),
            end,
            text: agent === VERIFIER ? verifierText(str(kid["id"]), end) : null,
          };
        });
        const all = [row, ...kids];
        let outcome = str(row["idle_outcome"]) || null;
        let idleAt = numOrNull(row["time_idle"]);
        if (outcome === null) {
          const idle = lastIdle(str(row["id"]));
          if (idle) {
            outcome = idle.outcome;
            idleAt ??= idle.at;
          }
        }
        runs.push({
          id: str(row["id"]),
          mode: match[1] === "triage" ? "triage" : "deliver",
          issue: Number(match[2]),
          attempt: Number(match[3]),
          start: num(row["time_created"]),
          end: outcome === null ? num(row["time_updated"]) : (idleAt ?? num(row["time_updated"])),
          outcome,
          costUsd: costOf(all),
          tokens: tokensOf(all),
          subagents,
        });
      }
      interactive.sort((a, b) => b.updatedAt - a.updatedAt);
      return { ok: true, data: { runs, interactive: interactive.slice(0, 20) } };
    } catch (error) {
      return { ok: false, reason: `cannot read ${path}: ${(error as Error).message}` };
    }
  }

  return {
    read,
    close() {
      db?.close();
      db = null;
      schema = null;
    },
  };
}
