// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { demoCollected } from "../../server/demo.ts";
import { buildSnapshot } from "../../server/derive/deliveries.ts";
import { Overview } from "./overview.tsx";

afterEach(cleanup);

const snapshot = buildSnapshot(demoCollected(Date.now()), "7d", {
  available: true,
  version: "2.0.22",
});

describe("Overview against the demo snapshot", () => {
  it("shows the busy worker with its issue, its title and its current phase", () => {
    render(<Overview snapshot={snapshot} />);

    const card = screen.getByRole("heading", { name: "booth-factory-1" }).closest("li");
    expect(card).not.toBeNull();
    const scope = within(card as HTMLElement);
    expect(scope.getByRole("link", { name: "#38" })).toBeTruthy();
    expect(scope.getByText(/Pull to refresh on the leaderboard/)).toBeTruthy();
    expect(scope.getByText("Review")).toBeTruthy();
    expect(scope.getByText("busy")).toBeTruthy();
  });

  it("shows the idle worker as idle with nothing to do", () => {
    render(<Overview snapshot={snapshot} />);

    const card = screen
      .getByRole("heading", { name: "booth-factory-2" })
      .closest("li") as HTMLElement;
    expect(within(card).getByText("idle")).toBeTruthy();
    expect(within(card).getByText("Nothing to do.")).toBeTruthy();
  });

  it("writes the state of each in-progress delivery as a word", () => {
    render(<Overview snapshot={snapshot} />);

    const table = screen.getByRole("table", { name: "Deliveries in progress" });
    expect(within(table).getByText("running")).toBeTruthy();
    expect(within(table).getByText("queued")).toBeTruthy();
  });

  it("counts the workers busy as 1 / 2 and lists the queued run under Waiting for a worker", () => {
    render(<Overview snapshot={snapshot} />);

    expect(screen.getByText("1 / 2")).toBeTruthy();
    const waiting = screen.getByRole("heading", { name: "Waiting for a worker" })
      .nextElementSibling as HTMLElement;
    expect(within(waiting).getByRole("link", { name: "#39" })).toBeTruthy();
  });
});
