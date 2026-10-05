// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatState } from "../../shared/schema.ts";
import { Chat } from "./chat.tsx";

// jsdom has no layout: give every element a size so the virtualizer has a viewport to fill.
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, value: 600 });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, value: 400 });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const base: ChatState = {
  messages: [],
  forms: [],
  permissionPending: false,
  running: false,
  failure: null,
};

function serve(state: ChatState) {
  const posts: { url: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        posts.push({ url, body: JSON.parse(String(init.body)) });
        return new Response("{}", { status: 202 });
      }
      return new Response(JSON.stringify(state), { status: 200 });
    }),
  );
  return posts;
}

describe("Chat", () => {
  it("renders agent markdown as a list and a code span, and never as raw HTML", async () => {
    serve({
      ...base,
      messages: [
        {
          id: "msg_1",
          role: "agent",
          parts: [
            {
              kind: "text",
              text: 'Ideas:\n\n- first\n- second `code`\n\n<script>window.pwned=1</script>\n\n<img src=x onerror="window.pwned=2">\n\n![tracker](https://example.com/t.png)',
            },
          ],
        },
      ],
    });

    const { container } = render(<Chat sessionId="ses_t" onGone={() => {}} />);

    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(2));
    expect(container.querySelector("code")?.textContent).toBe("code");
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect((window as unknown as { pwned?: number }).pwned).toBeUndefined();
  });

  it("opens agent links in a new tab with noopener", async () => {
    serve({
      ...base,
      messages: [
        {
          id: "msg_1",
          role: "agent",
          parts: [{ kind: "text", text: "[issue](https://example.com/1)" }],
        },
      ],
    });

    render(<Chat sessionId="ses_t" onGone={() => {}} />);

    const link = await screen.findByRole("link", { name: "issue" });
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("sends a pending form's option as the answer to that form", async () => {
    const posts = serve({
      ...base,
      forms: [
        {
          id: "frm_1",
          title: "Questions",
          fields: [
            {
              key: "q0",
              title: "Who",
              required: true,
              type: "string",
              custom: false,
              options: [
                { value: "Me", label: "Me" },
                { value: "My team", label: "My team" },
              ],
            },
          ],
        },
      ],
    });
    render(<Chat sessionId="ses_t" onGone={() => {}} />);

    fireEvent.click(await screen.findByRole("button", { name: "My team" }));

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({
      url: "/api/chat/ses_t/form/frm_1",
      body: { answer: { q0: "My team" } },
    });
  });

  it("labels a free-text form's own button Answer, apart from the composer's Send", async () => {
    serve({
      ...base,
      forms: [
        {
          id: "frm_2",
          title: "Questions",
          fields: [
            { key: "q0", title: "Why", required: true, type: "string", custom: true, options: [] },
          ],
        },
      ],
    });
    render(<Chat sessionId="ses_t" onGone={() => {}} />);

    const form = await screen.findByRole("form", { name: "Questions" });
    expect(within(form).getByRole("button", { name: "Answer" })).toBeTruthy();
    expect(within(form).queryByRole("button", { name: "Send" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Send" })).toHaveLength(1);
  });

  it("sends the message on Enter, keeps a newline on Shift+Enter, and clears the box", async () => {
    const posts = serve(base);
    render(<Chat sessionId="ses_t" onGone={() => {}} />);
    const box = await screen.findByRole("textbox", { name: "Message" });

    fireEvent.change(box, { target: { value: "a line" } });
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    expect(posts).toHaveLength(0);
    fireEvent.keyDown(box, { key: "Enter" });

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({ url: "/api/chat/ses_t/message", body: { text: "a line" } });
    await waitFor(() => expect((box as HTMLTextAreaElement).value).toBe(""));
  });

  it("shows thinking and a Stop button while a turn runs, and the server's refusal when a send fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) =>
        init?.method === "POST"
          ? new Response(JSON.stringify({ error: "OpenCode is down" }), { status: 503 })
          : new Response(JSON.stringify({ ...base, running: true })),
      ),
    );
    render(<Chat sessionId="ses_t" onGone={() => {}} />);
    await screen.findByText("thinking…");
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));

    expect((await screen.findByRole("alert")).textContent).toBe("OpenCode is down");
  });

  it("calls onGone when the console no longer knows the session", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "no chat" }), { status: 404 })),
    );
    const onGone = vi.fn();

    render(<Chat sessionId="ses_t" onGone={onGone} />);

    await waitFor(() => expect(onGone).toHaveBeenCalled());
  });
});
