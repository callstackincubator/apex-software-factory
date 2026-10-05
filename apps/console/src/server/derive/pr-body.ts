import type { StatusField } from "../../shared/schema.ts";

/**
 * The fields of the line after `### Status`:
 * `Implement: done (5/5 green)  Review: round 2, 0 open  Simulator: pass ...`. Each field is
 * optional and an unknown one is kept as it is. A field name is a capitalised word before a colon.
 */
export function parseStatusLine(body: string): StatusField[] {
  const lines = body.split(/\r?\n/);
  const at = lines.findIndex((line) => /^#{2,4}\s+Status\s*$/i.test(line.trim()));
  if (at < 0) return [];
  const line = lines.slice(at + 1).find((l) => l.trim() !== "");
  if (line === undefined || line.trim().startsWith("#")) return [];
  const fields: StatusField[] = [];
  const re = /(?:^|\s)([A-Z][A-Za-z]*):\s+/g;
  const marks: { key: string; from: number; valueAt: number }[] = [];
  for (let m = re.exec(line); m; m = re.exec(line)) {
    marks.push({ key: m[1] ?? "", from: m.index, valueAt: m.index + m[0].length });
  }
  marks.forEach((mark, i) => {
    const end = marks[i + 1]?.from ?? line.length;
    fields.push({ key: mark.key, value: line.slice(mark.valueAt, end).trim() });
  });
  return fields;
}

export interface ReviewSection {
  specFindings: number;
  specFixed: number;
  codeFindings: number;
  codeFixed: number;
  rejected: string[];
}

function section(body: string, heading: string): string[] | null {
  const lines = body.split(/\r?\n/);
  const at = lines.findIndex((l) => new RegExp(`^##\\s+${heading}\\s*$`, "i").test(l.trim()));
  if (at < 0) return null;
  const rest = lines.slice(at + 1);
  const next = rest.findIndex((l) => /^##\s/.test(l));
  return next < 0 ? rest : rest.slice(0, next);
}

/**
 * The `## Review` section: `Spec review: <n> findings, <m> fixed. Code review: <n> findings,
 * <m> fixed.` and the `Rejected:` bullets under it. `null` when there is no such counts line.
 */
export function parseReviewSection(body: string): ReviewSection | null {
  const lines = section(body, "Review");
  if (lines === null) return null;
  const text = lines.join("\n");
  const spec = /Spec review:\s*(\d+)\s+findings?,\s*(\d+)\s+fixed/i.exec(text);
  const code = /Code review:\s*(\d+)\s+findings?,\s*(\d+)\s+fixed/i.exec(text);
  if (!spec && !code) return null;
  const rejected: string[] = [];
  let inRejected = false;
  for (const line of lines) {
    if (/^\s*Rejected:\s*$/i.test(line)) {
      inRejected = true;
      continue;
    }
    if (!inRejected) continue;
    const item = /^\s*[-*]\s+(.+)$/.exec(line);
    if (item) rejected.push((item[1] ?? "").trim());
    else if (line.trim() !== "" && !line.trim().startsWith("_Written by")) inRejected = false;
  }
  return {
    specFindings: Number(spec?.[1] ?? 0),
    specFixed: Number(spec?.[2] ?? 0),
    codeFindings: Number(code?.[1] ?? 0),
    codeFixed: Number(code?.[2] ?? 0),
    rejected,
  };
}

/** Every `Assumption:` line in a PR body (a bullet or a plain line), without its marker. */
export function parseAssumptions(body: string): string[] {
  const out: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    const m = /^\s*(?:[-*]\s+)?Assumption:\s*(.+)$/.exec(line);
    if (m) out.push((m[1] ?? "").trim());
  }
  return out;
}
