import { describe, expect, it } from "vitest";
import { aggregateFindings, findingsFromPr } from "./findings.ts";
import { parseReport } from "./report.ts";

function report(
  spec: string,
  code: string,
  fix: string[],
  rejected: string[],
  nits: string[],
  needs = "none",
) {
  const list = (key: string, items: string[]) =>
    items.length === 0 ? `${key}: none` : `${key}:\n${items.map((i) => `- ${i}`).join("\n")}`;
  return parseReport(
    [
      "PR: #1  Round: 1  Kind: code",
      `Spec review: ${spec}  Code review: ${code}`,
      list("Fix", fix),
      list("Nits", nits),
      list("Rejected", rejected),
      `Spec needs: ${needs}`,
      "Rerun: none",
    ].join("\n"),
  );
}

describe("aggregateFindings", () => {
  it("adds raised and blocking over rounds and counts the Fix, Rejected and Nits items", () => {
    const f = aggregateFindings([
      report("2 findings (1 blocking)", "3 findings (2 blocking)", ["a", "b"], ["c"], ["n1"]),
      report("skipped", "1 findings (0 blocking)", [], [], ["n2", "n3"]),
    ]);

    expect(f).toMatchObject({
      rounds: 2,
      raised: 6,
      blocking: 3,
      confirmed: 2,
      rejected: 1,
      nits: 3,
    });
  });

  it("leaves unsorted as blocking minus confirmed minus rejected when positive", () => {
    const f = aggregateFindings([
      report("0 findings (0 blocking)", "4 findings (4 blocking)", ["a"], ["b"], []),
    ]);

    expect(f.unsorted).toBe(2);
  });

  it("never lets unsorted go negative", () => {
    const f = aggregateFindings([
      report("0 findings (0 blocking)", "1 findings (0 blocking)", ["a", "b"], [], []),
    ]);

    expect(f.unsorted).toBe(0);
  });

  it("counts the rounds whose Spec needs is not none", () => {
    const f = aggregateFindings([
      report("1 findings (1 blocking)", "0 findings (0 blocking)", [], [], [], "the empty state"),
      report("0 findings (0 blocking)", "0 findings (0 blocking)", [], [], []),
    ]);

    expect(f.specNeeds).toBe(1);
  });

  it("counts a round with no report as a round but not as known", () => {
    const f = aggregateFindings([null]);

    expect(f).toMatchObject({ rounds: 1, known: false, raised: 0 });
  });
});

describe("findingsFromPr", () => {
  it("fills raised and confirmed from the PR's counts, marked as from the PR", () => {
    const f = findingsFromPr({
      specFindings: 2,
      specFixed: 1,
      codeFindings: 3,
      codeFixed: 2,
      rejected: ["x"],
    });

    expect(f).toMatchObject({ known: true, fromPr: true, raised: 5, confirmed: 3, rejected: 1 });
  });
});
