// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { demoCollected } from "../../server/demo.ts";
import { buildSnapshot } from "../../server/derive/deliveries.ts";
import { Specs } from "./specs.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
});

const snapshot = buildSnapshot(demoCollected(Date.now()), "7d", { available: true });

const panel = (name: string) =>
  screen.getByRole("heading", { name }).closest("section") as HTMLElement;

describe("Specs against the demo snapshot", () => {
  it("lists each queue with a link to GitHub and the suggested action first and filled", () => {
    render(<Specs snapshot={snapshot} />);

    const business = within(panel("Needs business spec"));
    expect(business.getByRole("link", { name: /#44/ }).getAttribute("target")).toBe("_blank");
    const feature = business.getByRole("row", { name: /Friends' talks/ });
    const buttons = within(feature).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual([
      "Write business spec",
      "Write technical spec",
    ]);
    expect(buttons[0]?.className).not.toContain("secondary");
    expect(buttons[1]?.className).toContain("secondary");

    const technical = within(panel("Needs technical spec"));
    const lunch = technical.getByRole("row", { name: /Lunch matching/ });
    expect(within(lunch).getAllByRole("button")[0]?.textContent).toBe("Write technical spec");
  });

  it("offers a bare request only a business spec, and says when a queue is empty", () => {
    render(<Specs snapshot={snapshot} />);
    const request = within(panel("Needs business spec")).getByRole("row", { name: /#44/ });

    expect(
      within(request)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Write business spec"]);

    cleanup();
    render(
      <Specs
        snapshot={{ ...snapshot, specs: { business: [], technical: [], unavailable: null } }}
      />,
    );
    expect(screen.getByText("Nothing waits for a business spec.")).toBeTruthy();
    expect(screen.getByText("Nothing waits for a technical spec.")).toBeTruthy();
  });

  it("says the queues are unknown, not empty, when GitHub could not be read", () => {
    render(
      <Specs
        snapshot={{
          ...snapshot,
          specs: { business: [], technical: [], unavailable: "HTTP 502: Bad Gateway" },
        }}
      />,
    );

    expect(screen.getByRole("alert").textContent).toContain("HTTP 502: Bad Gateway");
    expect(screen.queryByText("Nothing waits for a business spec.")).toBeNull();
    expect(screen.getAllByText("Unknown until GitHub answers.")).toHaveLength(2);
  });

  it("starts a spec chat for the clicked mode and shows it under the issue's header", async () => {
    const posts: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === "POST") {
          posts.push(JSON.parse(String(init.body)));
          return new Response(JSON.stringify({ sessionId: "ses_s1" }), { status: 200 });
        }
        return new Response(
          JSON.stringify({
            messages: [],
            forms: [],
            permissionPending: false,
            running: false,
            failure: null,
          }),
          { status: 200 },
        );
      }),
    );
    render(<Specs snapshot={snapshot} />);

    const lunch = within(panel("Needs technical spec")).getByRole("row", {
      name: /Lunch matching/,
    });
    fireEvent.click(within(lunch).getByRole("button", { name: "Write technical spec" }));

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "#47 Lunch matching · technical" })).toBeTruthy(),
    );
    expect(posts).toEqual([{ role: "spec", issue: 47, mode: "technical" }]);
    fireEvent.click(screen.getByRole("button", { name: "Back to the queues" }));
    expect(screen.getByRole("heading", { name: "Needs technical spec" })).toBeTruthy();
  });
});
