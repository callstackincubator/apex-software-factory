import { describe, expect, it } from "vitest";
import { specIssue } from "../test-support.ts";
import { buildSpecs, openQuestions } from "./specs.ts";

const request = (n: number) =>
  specIssue({ number: n, labels: ["request:new"], title: `Idea ${n}` });
const feature = (n: number, body: string, labels = ["feature:spec"]) =>
  specIssue({ number: n, labels, body, title: `Feature ${n}` });
const withQuestions = (text: string) =>
  `Request: #1\n\n## Open questions\n${text}\n\n## Technical spec\nTBD`;

describe("buildSpecs", () => {
  it("queues an unanswered request for a business spec", () => {
    const specs = buildSpecs({ waiting: [request(7)], features: [] });

    expect(specs.business).toEqual([
      expect.objectContaining({ issue: 7, kind: "request", suggested: "business" }),
    ]);
    expect(specs.technical).toEqual([]);
  });

  it("drops a request once an open or a closed feature names it on a Request line", () => {
    const open = feature(20, "Request: #7\n\n## Open questions\nNone");
    const closed = feature(21, "Request: #8\n\nbody", ["feature:ready"]);
    const specs = buildSpecs({
      waiting: [request(7), request(8), request(9), open],
      features: [open, closed],
    });

    expect(specs.business.map((r) => r.issue)).toEqual([9]);
  });

  it("does not count a mention of a request elsewhere in a body as its feature", () => {
    const other = feature(20, "See also Request: #7 which is related", ["feature:ready"]);
    const specs = buildSpecs({ waiting: [request(7)], features: [other] });

    expect(specs.business.map((r) => r.issue)).toEqual([7]);
  });

  it("sends a feature:spec with only a comment or None under Open questions to the technical queue", () => {
    const specs = buildSpecs({
      waiting: [
        feature(30, withQuestions("<!-- Anything the spec leaves open? -->")),
        feature(31, withQuestions("None")),
        feature(32, withQuestions("\n- \n")),
      ],
      features: [],
    });

    expect(specs.technical.map((r) => r.issue).sort()).toEqual([30, 31, 32]);
    expect(specs.business).toEqual([]);
    expect(specs.technical[0]).toMatchObject({ kind: "feature", suggested: "technical" });
  });

  it("sends a feature:spec with a real open question to the business queue", () => {
    const specs = buildSpecs({
      waiting: [feature(33, withQuestions("<!-- hint -->\n- Who may delete a talk?"))],
      features: [],
    });

    expect(specs.business).toEqual([
      expect.objectContaining({ issue: 33, kind: "feature", suggested: "business" }),
    ]);
    expect(specs.technical).toEqual([]);
  });
});

describe("openQuestions", () => {
  it("reads only up to the next heading, and treats a missing section as empty", () => {
    expect(openQuestions("## Open questions\nWhy?\n## Next\nmore")).toBe("Why?");
    expect(openQuestions("## Something else\nWhy?")).toBe("");
  });
});
