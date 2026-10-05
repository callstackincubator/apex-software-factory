import { describe, expect, it } from "vitest";
import { leadingComment, parseWorkflow } from "./workflows.ts";

describe("parseWorkflow", () => {
  it("reads the name, a cron schedule, the dispatch inputs and where it runs", () => {
    const wf = parseWorkflow(
      "sweep.yml",
      `name: Nightly sweep

# Releases stale claims.
# Touches labels only.

on:
  schedule:
    - cron: "0 2 * * *"
    - cron: "30 14 * * 1"
  workflow_dispatch:
    inputs:
      dry_run:
        description: Only report
        type: boolean
        required: true
      note:
        description: A note
        default: hi
jobs:
  sweep:
    runs-on: [self-hosted, factory]
  other:
    runs-on: ubuntu-24.04
`,
    );

    expect(wf).toMatchObject({
      file: "sweep.yml",
      name: "Nightly sweep",
      description: "Releases stale claims.\nTouches labels only.",
      events: ["schedule", "workflow_dispatch"],
      crons: ["0 2 * * *", "30 14 * * 1"],
      runsOn: ["self-hosted", "factory", "ubuntu-24.04"],
      selfHosted: true,
    });
    expect(wf?.inputs).toEqual([
      { name: "dry_run", required: true, description: "Only report" },
      { name: "note", required: false, description: "A note" },
    ]);
  });

  it("reads on: [push] as the one event push with no cron", () => {
    const wf = parseWorkflow(
      "a.yml",
      "name: A\non: [push]\njobs:\n  x:\n    runs-on: ubuntu-latest\n",
    );

    expect(wf).toMatchObject({ events: ["push"], crons: [], inputs: [], selfHosted: false });
  });

  it("reads on: push as a string, and a workflow with no name as its file name", () => {
    const wf = parseWorkflow("b.yml", "on: push\njobs: {}\n");

    expect(wf).toMatchObject({ name: "b.yml", events: ["push"] });
  });

  it("reads on: { schedule: [...] } written inline", () => {
    const wf = parseWorkflow("c.yml", 'name: C\non: { schedule: [{ cron: "*/15 * * * *" }] }\n');

    expect(wf?.crons).toEqual(["*/15 * * * *"]);
    expect(wf?.events).toEqual(["schedule"]);
  });

  it("answers null for a file that is not valid YAML", () => {
    expect(parseWorkflow("d.yml", "name: [unclosed\n")).toBeNull();
  });
});

describe("leadingComment", () => {
  it("takes the first comment block, even after the name line, up to the first blank line", () => {
    expect(leadingComment("name: X\n\n# one\n#\n# two\n\n# not this\non: push\n")).toBe(
      "one\n\ntwo",
    );
  });

  it("is empty for a file with no comment", () => {
    expect(leadingComment("name: X\non: push\n")).toBe("");
  });
});
