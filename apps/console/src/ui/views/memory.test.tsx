// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createMemory } from "../../server/memory.ts";
import { demoGit } from "../../server/memory-demo.ts";
import type { MemoryResponse } from "../../shared/memory-schema.ts";
import { Memory } from "./memory.tsx";

afterEach(cleanup);

const NOW = Date.now();
const demo = (): Promise<MemoryResponse> =>
  createMemory({ now: () => NOW, git: demoGit(() => NOW) }).read();

describe("Memory against the demo memory", () => {
  it("shows a lesson, a retro title and a run row linking to its delivery", async () => {
    render(<Memory data={await demo()} />);

    expect(screen.getAllByText(/native build only when/).length).toBe(1);
    expect(screen.getByRole("link", { name: /Retro: five runs/ }).getAttribute("href")).toMatch(
      /^\/memory\/retros\//,
    );
    const runs = within(screen.getByRole("heading", { name: "Run records" }).closest("section")!);
    const row = runs.getAllByRole("row").find((r) => r.textContent?.includes("#37"));
    expect(row).toBeTruthy();
    expect(within(row!).getByRole("link", { name: "#37" }).getAttribute("href")).toBe(
      "/pipeline/37",
    );
  });

  it("says the memory is not written yet, as a normal state", async () => {
    const data = await demo();
    render(<Memory data={{ ...data, status: "empty" }} />);
    expect(screen.getByText("The factory has not written its memory yet.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
