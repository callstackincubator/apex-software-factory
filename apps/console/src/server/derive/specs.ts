import type { SpecRow, Specs } from "../../shared/schema.ts";
import type { SpecIssue, SpecsRead } from "../github.ts";

/** The request a feature answers: its body's `Request: #<n>` line (the template's first line). */
export function requestOf(body: string): number | null {
  const found = /^[ \t]*Request:[ \t]*#(\d+)\b/im.exec(body);
  return found === null ? null : Number(found[1]);
}

/** The text under `## Open questions`, up to the next heading, without comments and a lone "none". */
export function openQuestions(body: string): string {
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const start = lines.findIndex((line) => /^#{1,6}[ \t]+open questions[ \t]*#*[ \t]*$/i.test(line));
  if (start === -1) return "";
  let end = lines.findIndex((line, i) => i > start && /^#{1,6}[ \t]/.test(line));
  if (end === -1) end = lines.length;
  const section = lines
    .slice(start + 1, end)
    .join("\n")
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim();
  return /^(?:[-*][ \t]*)?none\.?$/i.test(section) || section === "-" ? "" : section;
}

const has = (issue: SpecIssue, label: string) => issue.labels.includes(label);

/**
 * The two queues of the Specs tab (CONSOLE.md 2.7). A request waits for a business spec until a
 * feature names it; a `feature:spec` waits for one while its open questions have content, and
 * for the technical spec otherwise, until a person sets `feature:ready`.
 */
export function buildSpecs(read: SpecsRead): Specs {
  const answered = new Set<number>();
  for (const feature of read.features) {
    const request = requestOf(feature.body);
    if (request !== null) answered.add(request);
  }
  const row = (issue: SpecIssue, kind: SpecRow["kind"], suggested: SpecRow["suggested"]) => ({
    issue: issue.number,
    title: issue.title,
    url: issue.url,
    kind,
    suggested,
    updatedAt: issue.updatedAt,
  });

  const business: SpecRow[] = [];
  const technical: SpecRow[] = [];
  for (const issue of read.waiting) {
    if (has(issue, "feature:spec")) {
      if (openQuestions(issue.body) !== "") business.push(row(issue, "feature", "business"));
      else technical.push(row(issue, "feature", "technical"));
    } else if (has(issue, "request:new") && !answered.has(issue.number)) {
      business.push(row(issue, "request", "business"));
    }
  }
  const newest = (a: SpecRow, b: SpecRow) => b.updatedAt - a.updatedAt || a.issue - b.issue;
  return {
    business: business.sort(newest),
    technical: technical.sort(newest),
    unavailable: read.error ?? null,
  };
}
