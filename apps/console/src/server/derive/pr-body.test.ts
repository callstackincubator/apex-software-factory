import { describe, expect, it } from "vitest";
import { parseAssumptions, parseReviewSection, parseStatusLine } from "./pr-body.ts";

describe("parseStatusLine", () => {
  it("splits the line after ### Status into its fields", () => {
    const body = `## Summary\n\nx\n\n### Status\n\nImplement: done (5/5 green)  Review: round 2, 0 open  Simulator: pass  Native: no  Gate: merged\n\n## Done when`;

    expect(parseStatusLine(body)).toEqual([
      { key: "Implement", value: "done (5/5 green)" },
      { key: "Review", value: "round 2, 0 open" },
      { key: "Simulator", value: "pass" },
      { key: "Native", value: "no" },
      { key: "Gate", value: "merged" },
    ]);
  });

  it("keeps a field it does not know and tolerates missing ones", () => {
    const fields = parseStatusLine(
      "### Status\nImplement: red (0/3 green) Lane: slow Gate: pending",
    );

    expect(fields.map((f) => f.key)).toEqual(["Implement", "Lane", "Gate"]);
    expect(fields[1]?.value).toBe("slow");
  });

  it("answers no fields when the body has no Status heading", () => {
    expect(parseStatusLine("## Summary\n\nnothing here")).toEqual([]);
  });
});

describe("parseReviewSection", () => {
  const body = `## Review

Spec review: 3 findings, 2 fixed. Code review: 4 findings, 1 fixed.

Rejected:

- the picker should persist — local only
- rename the hook — taste

_Written by an agent._`;

  it("reads both counts lines", () => {
    expect(parseReviewSection(body)).toMatchObject({
      specFindings: 3,
      specFixed: 2,
      codeFindings: 4,
      codeFixed: 1,
    });
  });

  it("collects the Rejected bullets and stops before the footer", () => {
    expect(parseReviewSection(body)?.rejected).toEqual([
      "the picker should persist — local only",
      "rename the hook — taste",
    ]);
  });

  it("answers null without a Review section or without its counts line", () => {
    expect(parseReviewSection("## Summary\n\nx")).toBeNull();
    expect(parseReviewSection("## Review\n\npending")).toBeNull();
  });

  it("stops at the next section", () => {
    const review = parseReviewSection(
      `## Review\n\nSpec review: 1 findings, 1 fixed. Code review: 0 findings, 0 fixed.\n\n## Other\n\nCode review: 9 findings, 9 fixed.`,
    );

    expect(review?.codeFindings).toBe(0);
  });
});

describe("parseAssumptions", () => {
  it("lists each Assumption line, bullet or plain, without its marker", () => {
    const body = `## Assumptions\n\n- Assumption: five moods are enough\nAssumption: names are trimmed\n- something else`;

    expect(parseAssumptions(body)).toEqual(["five moods are enough", "names are trimmed"]);
  });

  it("answers an empty list for none", () => {
    expect(parseAssumptions("## Assumptions\n\nnone")).toEqual([]);
  });
});
