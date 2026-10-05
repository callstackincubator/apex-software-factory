import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { GhRunner } from "./github.ts";
import { createAutomationsCollector } from "./service.ts";

const temp: string[] = [];
afterEach(() => {
  while (temp.length > 0) rmSync(temp.pop() ?? "", { recursive: true, force: true });
});

describe("automations collector", () => {
  it("asks GitHub again only once a minute has passed, however often it is asked", async () => {
    const dir = mkdtempSync(join(tmpdir(), "console-workflows-"));
    temp.push(dir);
    let calls = 0;
    const gh: GhRunner = async () => {
      calls += 1;
      return JSON.stringify({ workflows: [] });
    };
    let now = 1_000_000;
    const collector = createAutomationsCollector({
      now: () => now,
      gh,
      repo: "o/r",
      workflowsDir: dir,
    });

    await collector.collect();
    const first = calls;
    now += 59_000;
    await collector.collect();
    expect(calls).toBe(first);
    now += 1_000;
    await collector.collect();
    expect(calls).toBeGreaterThan(first);
  });
});
