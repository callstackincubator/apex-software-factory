import type { Report } from "../../shared/schema.ts";

const KEYS = ["Fix", "Nits", "Rejected", "Spec needs", "Rerun"] as const;
const KEY_LINE = new RegExp(`^(${KEYS.join("|")}):\\s*(.*)$`);

function isNone(value: string): boolean {
  return /^none\.?$/i.test(value.trim());
}

function reviewCounts(
  line: string,
  label: "Spec review" | "Code review",
): { findings: number | null; blocking: number | null; skipped: boolean } {
  const m = new RegExp(
    `${label}:\\s*(skipped|(\\d+)\\s+findings?(?:\\s*\\(\\s*(\\d+)\\s+blocking\\s*\\))?)`,
    "i",
  ).exec(line);
  if (!m) return { findings: null, blocking: null, skipped: false };
  if (m[1]?.toLowerCase() === "skipped") return { findings: null, blocking: null, skipped: true };
  const findings = Number(m[2]);
  return { findings, blocking: m[3] === undefined ? 0 : Number(m[3]), skipped: false };
}

/**
 * The review-verifier's report block (`.opencode/agent/review-verifier.md`), the last one in
 * `text`. A text without a block is `null`: "no report".
 */
export function parseReport(text: string): Report | null {
  const lines = text.split(/\r?\n/).filter((line) => !/^\s*```/.test(line));
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^PR:\s*/.test(lines[i] ?? "")) start = i;
  }
  if (start < 0) return null;
  const block = lines.slice(start);
  // A block has its two header lines; "PR:" alone in prose is not one.
  const reviewLine = block.find((line) => /Spec review:/i.test(line) || /Code review:/i.test(line));
  if (reviewLine === undefined) return null;

  const head = block[0] ?? "";
  const pr = /PR:\s*#?(\d+)/.exec(head);
  const round = /Round:\s*(\d+)/.exec(head);
  const kind = /Kind:\s*([\w-]+)/.exec(head);
  const spec = reviewCounts(reviewLine, "Spec review");
  const code = reviewCounts(reviewLine, "Code review");

  const lists: Record<string, string[]> = {};
  let current: string | null = null;
  for (const line of block.slice(1)) {
    const key = KEY_LINE.exec(line);
    if (key) {
      current = key[1] ?? null;
      lists[current ?? ""] = [];
      const rest = (key[2] ?? "").trim();
      if (current && rest !== "" && !isNone(rest)) lists[current]?.push(rest.replace(/^-\s+/, ""));
      continue;
    }
    if (current === null) continue;
    const item = line.trim().replace(/^-\s+/, "");
    if (item !== "" && !isNone(item)) lists[current]?.push(item);
  }

  const needs = (lists["Spec needs"] ?? []).join(" ").trim();
  const rerun = (lists["Rerun"] ?? []).join(" ").trim();
  return {
    pr: pr ? Number(pr[1]) : null,
    round: round ? Number(round[1]) : null,
    kind: kind?.[1] ?? null,
    specFindings: spec.findings,
    specBlocking: spec.blocking,
    specSkipped: spec.skipped,
    codeFindings: code.findings,
    codeBlocking: code.blocking,
    codeSkipped: code.skipped,
    fix: lists["Fix"] ?? [],
    nits: lists["Nits"] ?? [],
    rejected: lists["Rejected"] ?? [],
    specNeeds: needs === "" ? null : needs,
    rerun: rerun === "" ? null : rerun,
  };
}
