import { describe, expect, it } from "vitest";
import { parseReport } from "./report.ts";

const BLOCK = `PR: #42  Round: 2  Kind: code
Spec review: 3 findings (1 blocking)  Code review: 5 findings (2 blocking)
Fix: apps/mobile/src/a.tsx:10 label missing
Nits: apps/mobile/src/b.tsx:3 unused import
Rejected: the picker should persist — spec says local only
Spec needs: none
Rerun: code`;

describe("parseReport", () => {
  it("reads the counts, blocking counts, kind, round and PR of the header lines", () => {
    const report = parseReport(BLOCK);

    expect(report).toMatchObject({
      pr: 42,
      round: 2,
      kind: "code",
      specFindings: 3,
      specBlocking: 1,
      codeFindings: 5,
      codeBlocking: 2,
      specSkipped: false,
      codeSkipped: false,
      rerun: "code",
    });
  });

  it("takes a one-line Fix, Nits and Rejected as one item each", () => {
    const report = parseReport(BLOCK);

    expect(report?.fix).toEqual(["apps/mobile/src/a.tsx:10 label missing"]);
    expect(report?.nits).toEqual(["apps/mobile/src/b.tsx:3 unused import"]);
    expect(report?.rejected).toEqual(["the picker should persist — spec says local only"]);
  });

  it("takes one item per following line for a multi-line list, with or without a dash", () => {
    const report = parseReport(`PR: #7  Round: 1  Kind: code
Spec review: 0 findings (0 blocking)  Code review: 2 findings (2 blocking)
Fix:
- apps/a.ts:1 first
apps/b.ts:2 second
Nits: none
Rejected: none
Spec needs: none
Rerun: code`);

    expect(report?.fix).toEqual(["apps/a.ts:1 first", "apps/b.ts:2 second"]);
  });

  it("reads none as an empty list and a Spec needs of none as null", () => {
    const report = parseReport(`PR: #7  Round: 1  Kind: no-spec
Spec review: skipped  Code review: 0 findings (0 blocking)
Fix: none
Nits: none.
Rejected: None
Spec needs: none
Rerun: none`);

    expect(report).toMatchObject({ fix: [], nits: [], rejected: [], specNeeds: null });
  });

  it("reports a skipped review as skipped with no count", () => {
    const report = parseReport(`PR: #7  Round: 1  Kind: adr-only
Spec review: skipped  Code review: 1 findings (0 blocking)
Fix: none
Nits: none
Rejected: none
Spec needs: none
Rerun: none`);

    expect(report).toMatchObject({
      specSkipped: true,
      specFindings: null,
      specBlocking: null,
      codeSkipped: false,
      codeFindings: 1,
    });
  });

  it("keeps the Spec needs line when it is not none", () => {
    const report = parseReport(
      BLOCK.replace("Spec needs: none", "Spec needs: the empty state of the list"),
    );

    expect(report?.specNeeds).toBe("the empty state of the list");
  });

  it("finds the block after prose, and inside a code fence", () => {
    const report = parseReport(`I checked everything. The PR: it looks fine.

\`\`\`
${BLOCK}
\`\`\``);

    expect(report?.pr).toBe(42);
    expect(report?.fix).toHaveLength(1);
  });

  it("takes the last block when a text holds two", () => {
    const first = BLOCK.replace("Round: 2", "Round: 1").replace(
      "Fix: apps/mobile/src/a.tsx:10 label missing",
      "Fix: none",
    );
    const report = parseReport(`${first}\n\nOn second thought:\n\n${BLOCK}`);

    expect(report?.round).toBe(2);
    expect(report?.fix).toHaveLength(1);
  });

  it("answers null for a text with no block", () => {
    expect(parseReport("I could not read the reviews.")).toBeNull();
    expect(parseReport("PR: #3 is the one I looked at, nothing else")).toBeNull();
  });
});
