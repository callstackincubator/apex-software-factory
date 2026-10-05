// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { demoCollected } from "../../server/demo.ts";
import { buildSnapshot } from "../../server/derive/deliveries.ts";
import { SnapshotContext } from "../data.tsx";
import { OpencodeView } from "./opencode.tsx";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const snapshot = buildSnapshot(demoCollected(Date.now()), "7d", {
  available: true,
  version: "2.0.22",
});
const renderView = () =>
  render(
    <SnapshotContext.Provider value={{ snapshot, error: null, window: "7d", setWindow: () => {} }}>
      <OpencodeView />
    </SnapshotContext.Provider>,
  );

function fakeTab() {
  return { location: { href: "" }, close: vi.fn() } as unknown as Window & {
    close: ReturnType<typeof vi.fn>;
  };
}

describe("Open OpenCode", () => {
  it("opens the tab from the click, before the answer, then gives it the returned link", async () => {
    const tab = fakeTab();
    const open = vi.spyOn(window, "open").mockReturnValue(tab);
    let answer: (r: Response) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>((resolve) => (answer = resolve))),
    );
    renderView();

    fireEvent.click(screen.getByRole("button", { name: "Open OpenCode" }));

    expect(open).toHaveBeenCalledWith("", "_blank");
    expect(tab.location.href).toBe("");
    answer(
      new Response(
        JSON.stringify({ url: "http://127.0.0.1:4096/auth/connect/AbC", expiresInMinutes: 5 }),
      ),
    );
    await waitFor(() => expect(tab.location.href).toBe("http://127.0.0.1:4096/auth/connect/AbC"));
    expect(screen.getByText(/expires in 5 minutes/)).toBeTruthy();
  });

  it("closes the tab and shows OpenCode's message when pairing fails", async () => {
    const tab = fakeTab();
    vi.spyOn(window, "open").mockReturnValue(tab);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "opencode is not on PATH" }), { status: 503 }),
      ),
    );
    renderView();

    fireEvent.click(screen.getByRole("button", { name: "Open OpenCode" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("opencode is not on PATH"),
    );
    expect(tab.close).toHaveBeenCalled();
    expect(tab.location.href).toBe("");
  });
});
