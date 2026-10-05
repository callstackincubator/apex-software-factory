import type { MemoryLesson, MemoryRetro, MemoryRun } from "../../shared/memory-schema.ts";

/** Parsers for the memory branch's files. Defensive: a file that does not parse still shows. */

/** Only these paths are ever read from the branch (and none with `..`). */
export const MEMORY_PATH = /^(lessons|curated|runs|retros)\/[A-Za-z0-9._/-]+\.md$/;

export function allowedMemoryPath(path: string): boolean {
  return MEMORY_PATH.test(path) && !path.includes("..") && !path.includes("//");
}

const utc = (y: string, mo: string, d: string, h = "0", mi = "0", s = "0"): number =>
  Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));

/** `20261007-120000` from a file name's start, as UTC milliseconds. */
export function stampOf(name: string): number | null {
  const m = /(?:^|\/)(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/.exec(name);
  return m === null ? null : utc(m[1]!, m[2]!, m[3]!, m[4], m[5], m[6]);
}

/**
 * A raw lesson (`memory.sh lesson`): `key: value` lines, a blank line, the text. A file without
 * that shape is all text.
 */
export function parseLesson(path: string, content: string): MemoryLesson | null {
  const topic = path.split("/")[1] ?? "";
  const id = (path.split("/").pop() ?? path).replace(/\.md$/, "");
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const meta = new Map<string, string>();
  let body = lines;
  const blank = lines.indexOf("");
  if (blank > 0 && lines.slice(0, blank).every((l) => /^[a-z][a-z-]*: /.test(l))) {
    for (const l of lines.slice(0, blank)) {
      const i = l.indexOf(": ");
      meta.set(l.slice(0, i), l.slice(i + 2).trim());
    }
    body = lines.slice(blank + 1);
  }
  const text = body.join(" ").replace(/\s+/g, " ").trim();
  if (text === "") return null;
  const parsed = Date.parse(meta.get("date") ?? "");
  const issue = Number(meta.get("issue"));
  return {
    path,
    topic: meta.get("topic") || topic,
    id,
    text,
    by: meta.get("by") || null,
    date: Number.isNaN(parsed) ? stampOf(id) : parsed,
    issue: Number.isInteger(issue) && issue > 0 ? issue : null,
  };
}

/** `m:ss` or `h:mm:ss` as run-record.sh's `mmss` prints it. */
function clock(text: string): number | null {
  const m = /^(\d+):(\d{2})$/.exec(text.trim());
  return m === null ? null : (Number(m[1]) * 60 + Number(m[2])) * 1000;
}

/**
 * A run digest (`run-record.sh`): `# Run: <mode> #<issue>, attempt <n>`, `- Started: <UTC time>`,
 * `- Ended: stopped: <reason>` or `- Ended: on its own ...`, and a stage table whose first row is
 * the top session. The file name `<YYYYMMDD-HHMMSS>-<mode>-<issue>-a<attempt>.md` backs up the
 * heading when the content is cut or odd.
 */
export function parseRun(path: string, content: string): MemoryRun {
  const name = (path.split("/").pop() ?? path).replace(/\.md$/, "");
  const fromName = /^\d{8}-\d{6}-([a-z-]+)-(\d+)-a(\d+)$/.exec(name);
  const head = /^# Run: ([a-z-]+) #(\d+), attempt (\d+)/m.exec(content);
  const started = /^- Started: (\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/m.exec(content);
  const ended = /^- Ended: (.*)$/m.exec(content);
  const stopped = ended === null ? null : /^stopped:\s*(.*)$/.exec(ended[1]!.trim());
  // Skip the header and separator rows; the first data row's Time is the third cell.
  const row = content
    .split("\n")
    .find((l) => l.startsWith("| ") && !l.startsWith("| Agent") && !l.startsWith("| ---"));
  const cells = row?.split("|").map((c) => c.trim());
  const issue = Number(head?.[2] ?? fromName?.[2]);
  const attempt = Number(head?.[3] ?? fromName?.[3]);
  return {
    path,
    startedAt:
      started === null
        ? stampOf(name)
        : utc(started[1]!, started[2]!, started[3]!, started[4], started[5], started[6]),
    mode: head?.[1] ?? fromName?.[1] ?? "run",
    issue: Number.isInteger(issue) && issue > 0 ? issue : null,
    attempt: Number.isInteger(attempt) && attempt > 0 ? attempt : null,
    outcome: stopped !== null ? "stopped" : ended === null ? "unknown" : "finished",
    reason: stopped === null ? null : stopped[1] || "no reason recorded",
    durationMs: cells === undefined ? null : clock(cells[3] ?? ""),
  };
}

/** A retro report: the date from `retros/<date>.md`, the title from its first heading. */
export function parseRetro(path: string, content: string): MemoryRetro {
  const name = (path.split("/").pop() ?? path).replace(/\.md$/, "");
  const heading = /^#{1,2}[ \t]+(.+?)[ \t#]*$/m.exec(content);
  return { path, date: name, title: heading?.[1] ?? `Retro ${name}` };
}
