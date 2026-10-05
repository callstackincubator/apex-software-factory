import { describe, expect, it, vi } from "vitest";
import { ChatState, type SpecRow } from "../shared/schema.ts";
import { createApp } from "./app.ts";
import { createChatService } from "./chat.ts";
import { demoChat, demoCollector } from "./demo.ts";
import type { OpencodeApi, RawMessage } from "./opencode-api.ts";
import { NOW } from "./test-support.ts";

const PORT = 4280;
const POST = {
  method: "POST",
  headers: {
    host: `127.0.0.1:${PORT}`,
    origin: `http://127.0.0.1:${PORT}`,
    "content-type": "application/json",
  },
};
const GET = { headers: { host: `127.0.0.1:${PORT}` } };
const json = (body: unknown) => ({ ...POST, body: JSON.stringify(body) });

function fakeApi(over: Partial<OpencodeApi> = {}) {
  const api: OpencodeApi = {
    agentIds: vi.fn(async () => ["build", "intake"]),
    createSession: vi.fn(async () => "ses_abc123"),
    command: vi.fn(async () => {}),
    prompt: vi.fn(async () => {}),
    messages: vi.fn(async () => []),
    forms: vi.fn(async () => []),
    replyForm: vi.fn(async () => {}),
    permissionCount: vi.fn(async () => 0),
    interrupt: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    ...over,
  };
  return api;
}

function makeApp(api: OpencodeApi, specRow?: Parameters<typeof createChatService>[0]["specRow"]) {
  return createApp({
    port: PORT,
    demo: false,
    distDir: "/nonexistent",
    collector: demoCollector(() => NOW),
    automations: {
      collect: async () => ({
        now: NOW,
        repo: null,
        files: [],
        states: new Map(),
        runs: new Map(),
        notes: [],
      }),
    },
    opencode: {
      info: async () => ({ available: true }),
      pair: async () => ({ url: "", expiresInMinutes: 5 }),
    },
    chat: createChatService({ api, ...(specRow === undefined ? {} : { specRow }) }),
    dispatch: async () => {},
    dispatchWorkflow: async () => {},
  });
}

const raw = (m: Partial<RawMessage> & { id: string; type: string }): RawMessage => ({
  parts: [],
  ...m,
});

describe("chat routes", () => {
  it("starts the intake role on the intake agent and opens it with the intent command", async () => {
    const api = fakeApi();
    const res = await makeApp(api).request("/api/chat", json({ role: "intake" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sessionId: "ses_abc123" });
    expect(api.createSession).toHaveBeenCalledWith({ agent: "intake", title: "Idea · console" });
    expect(api.command).toHaveBeenCalledWith("ses_abc123", "intent", "");
  });

  it("refuses a role it does not know, and an agent name the page tries to pick", async () => {
    const api = fakeApi();
    const app = makeApp(api);

    expect((await app.request("/api/chat", json({ role: "build" }))).status).toBe(400);
    expect((await app.request("/api/chat", json({ role: "intake", agent: "build" }))).status).toBe(
      200,
    );
    expect(api.createSession).toHaveBeenCalledTimes(1);
    expect(api.createSession).toHaveBeenCalledWith(expect.objectContaining({ agent: "intake" }));
  });

  it("refuses to start when OpenCode has no intake agent, without creating a session", async () => {
    const api = fakeApi({ agentIds: vi.fn(async () => ["build"]) });

    const res = await makeApp(api).request("/api/chat", json({ role: "intake" }));

    expect(res.status).toBe(409);
    expect(api.createSession).not.toHaveBeenCalled();
  });

  it("answers 404 for a session this console did not create, on every chat route", async () => {
    const api = fakeApi();
    const app = makeApp(api);
    const other = "/api/chat/ses_notmine";

    expect((await app.request(other, GET)).status).toBe(404);
    expect((await app.request(`${other}/message`, json({ text: "hi" }))).status).toBe(404);
    expect((await app.request(`${other}/form/frm_1`, json({ answer: { q0: "a" } }))).status).toBe(
      404,
    );
    expect((await app.request(`${other}/stop`, json({}))).status).toBe(404);
    expect((await app.request("/api/chat/..%2Fsession", GET)).status).toBe(404);
    expect(api.prompt).not.toHaveBeenCalled();
    expect(api.interrupt).not.toHaveBeenCalled();
    expect(api.messages).not.toHaveBeenCalled();
  });

  it("rejects an empty or over-long message and sends a trimmed one", async () => {
    const api = fakeApi();
    const app = makeApp(api);
    await app.request("/api/chat", json({ role: "intake" }));
    const url = "/api/chat/ses_abc123/message";

    expect((await app.request(url, json({ text: "   " }))).status).toBe(400);
    expect((await app.request(url, json({ text: "x".repeat(8001) }))).status).toBe(400);
    expect(api.prompt).not.toHaveBeenCalled();
    expect((await app.request(url, json({ text: "  an idea  " }))).status).toBe(202);
    expect(api.prompt).toHaveBeenCalledWith("ses_abc123", "an idea");
  });

  it("refuses a chat POST without the console's own Origin", async () => {
    const res = await makeApp(fakeApi()).request("/api/chat", {
      ...json({ role: "intake" }),
      headers: {
        host: `127.0.0.1:${PORT}`,
        origin: "http://evil.example",
        "content-type": "application/json",
      },
    });

    expect(res.status).toBe(403);
  });

  it("returns the conversation oldest first, without reasoning or the command's own prompt", async () => {
    const api = fakeApi({
      messages: vi.fn(async () => [
        raw({ id: "msg_1", type: "user", text: "Load the intent skill" }),
        raw({
          id: "msg_2",
          type: "assistant",
          parts: [
            { type: "reasoning", text: "secret thoughts" },
            {
              type: "tool",
              name: "skill",
              state: { status: "completed", input: { id: "intent" } },
            },
            { type: "tool", name: "question", state: { status: "running", input: {} } },
            { type: "text", text: "Hello!" },
          ],
        }),
        raw({ id: "msg_3", type: "user", text: "my idea" }),
      ]),
      forms: vi.fn(async () => [
        {
          id: "frm_1",
          title: "Questions",
          pending: true,
          fields: [
            {
              key: "q0",
              type: "string",
              title: "Who",
              options: [],
              choices: [{ value: "me", label: "Me" }],
            },
          ],
        },
      ]),
    });
    const app = makeApp(api);
    await app.request("/api/chat", json({ role: "intake" }));

    const state = ChatState.parse(await (await app.request("/api/chat/ses_abc123", GET)).json());

    expect(
      state.messages.map((m) => [
        m.role,
        m.parts.map((p) => (p.kind === "text" ? p.text : p.tool.summary)),
      ]),
    ).toEqual([
      ["agent", ["loaded skill intent", "Hello!"]],
      ["user", ["my idea"]],
    ]);
    expect(JSON.stringify(state)).not.toContain("secret thoughts");
    expect(state.running).toBe(true);
    expect(state.forms[0]?.fields[0]?.options).toEqual([{ value: "me", label: "Me" }]);
  });

  it("is not running once the turn ends with an idle message", async () => {
    const api = fakeApi({
      messages: vi.fn(async () => [
        raw({ id: "msg_1", type: "user", text: "x" }),
        raw({ id: "msg_2", type: "idle", outcome: "succeeded" }),
      ]),
    });
    const app = makeApp(api);
    await app.request("/api/chat", json({ role: "intake" }));

    const state = ChatState.parse(await (await app.request("/api/chat/ses_abc123", GET)).json());

    expect(state.running).toBe(false);
  });
});

describe("demo chat", () => {
  it("walks a scripted conversation through the same routes, with a form to answer", async () => {
    const app = createApp({
      port: PORT,
      demo: true,
      distDir: "/nonexistent",
      collector: demoCollector(() => NOW),
      automations: {
        collect: async () => ({
          now: NOW,
          repo: null,
          files: [],
          states: new Map(),
          runs: new Map(),
          notes: [],
        }),
      },
      opencode: {
        info: async () => ({ available: true }),
        pair: async () => ({ url: "", expiresInMinutes: 5 }),
      },
      chat: demoChat(),
      dispatch: async () => {},
      dispatchWorkflow: async () => {},
    });
    const { sessionId } = (await (
      await app.request("/api/chat", json({ role: "intake" }))
    ).json()) as { sessionId: string };

    await app.request(`/api/chat/${sessionId}/message`, json({ text: "see friends' talks" }));
    const asked = ChatState.parse(await (await app.request(`/api/chat/${sessionId}`, GET)).json());
    const form = asked.forms[0];
    await app.request(
      `/api/chat/${sessionId}/form/${form?.id}`,
      json({ answer: { q0: "My team" } }),
    );
    const answered = ChatState.parse(
      await (await app.request(`/api/chat/${sessionId}`, GET)).json(),
    );

    expect(form?.fields[0]?.options.length).toBeGreaterThan(0);
    expect(answered.forms).toEqual([]);
    expect(
      answered.messages.some((m) => m.role === "user" && JSON.stringify(m).includes("My team")),
    ).toBe(true);
  });
});

describe("spec chat", () => {
  const rows: Record<number, SpecRow> = {
    42: { issue: 42, title: "A", url: "u", kind: "feature", suggested: "technical", updatedAt: 1 },
    43: { issue: 43, title: "B", url: "u", kind: "request", suggested: "business", updatedAt: 1 },
  };
  const specApi = () => fakeApi({ agentIds: vi.fn(async () => ["build", "intake", "spec"]) });
  const appOver = (api: OpencodeApi) => makeApp(api, async (issue) => rows[issue] ?? null);

  it("opens a technical spec as `/spec 42 technical` on the spec agent", async () => {
    const api = specApi();
    const res = await appOver(api).request(
      "/api/chat",
      json({ role: "spec", issue: 42, mode: "technical" }),
    );

    expect(res.status).toBe(200);
    expect(api.createSession).toHaveBeenCalledWith({
      agent: "spec",
      title: "Spec #42 · technical",
    });
    expect(api.command).toHaveBeenCalledWith("ses_abc123", "spec", "42 technical");
  });

  it("writes the business spec of a request as the bare number and of a feature with `business`", async () => {
    const api = specApi();
    const app = appOver(api);
    await app.request("/api/chat", json({ role: "spec", issue: 43, mode: "business" }));
    await app.request("/api/chat", json({ role: "spec", issue: 42, mode: "business" }));

    expect(vi.mocked(api.command).mock.calls.map((c) => c[2])).toEqual(["43", "42 business"]);
  });

  it("refuses an issue that waits in no queue, and a technical spec for a bare request", async () => {
    const api = specApi();
    const app = appOver(api);

    const stranger = await app.request(
      "/api/chat",
      json({ role: "spec", issue: 7, mode: "business" }),
    );
    const early = await app.request(
      "/api/chat",
      json({ role: "spec", issue: 43, mode: "technical" }),
    );

    expect(stranger.status).toBe(409);
    expect(early.status).toBe(409);
    expect(api.createSession).not.toHaveBeenCalled();
  });

  it("rejects an issue that is not a positive integer, and a mode it does not know", async () => {
    const api = specApi();
    const app = appOver(api);

    for (const body of [
      { role: "spec", issue: 4.5, mode: "business" },
      { role: "spec", issue: "42", mode: "business" },
      { role: "spec", issue: 0, mode: "business" },
      { role: "spec", issue: 42, mode: "ship" },
    ]) {
      expect((await app.request("/api/chat", json(body))).status).toBe(400);
    }
    expect(api.createSession).not.toHaveBeenCalled();
  });

  it("starts a scripted spec session in demo mode that names the issue", async () => {
    const chat = demoChat();
    const { sessionId } = await chat.start({ role: "spec", issue: 47, mode: "technical" });
    const state = await chat.state(sessionId);

    expect(JSON.stringify(state.messages)).toContain("#47");
  });
});
