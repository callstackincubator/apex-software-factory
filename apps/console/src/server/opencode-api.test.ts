import { describe, expect, it } from "vitest";
import type { Exec } from "./opencode-cli.ts";
import { createOpencodeApi, OpencodeApiError } from "./opencode-api.ts";

function stub(stdout: string, stderr = "") {
  const calls: string[][] = [];
  const exec: Exec = async (_file, args) => {
    calls.push(args);
    return { stdout, stderr };
  };
  return { api: createOpencodeApi({ cwd: "/repo root", exec }), calls };
}

describe("opencode api client", () => {
  it("reads a message list oldest first, keeping text and tools and passing an unknown content type", async () => {
    const { api } = stub(
      JSON.stringify({
        data: [
          {
            id: "msg_3",
            type: "assistant",
            content: [
              { type: "hologram", payload: 1 },
              { type: "text", text: "hello" },
              {
                type: "tool",
                name: "skill",
                state: { status: "completed", input: { id: "intent" } },
              },
              "not even an object",
            ],
          },
          { id: "msg_2", type: "user", text: "hi" },
          { id: "msg_1", type: "future-kind", whatever: true },
          { nope: true },
        ],
        cursor: {},
      }),
    );

    const messages = await api.messages("ses_a");

    expect(messages.map((m) => m.id)).toEqual(["msg_1", "msg_2", "msg_3"]);
    expect(messages[2]?.parts.map((p) => p.type)).toEqual(["hologram", "text", "tool"]);
  });

  it("raises the HTTP status and message when the output ends in an HTTP 404 line", async () => {
    const { api } = stub(
      '{"_tag":"SessionNotFoundError","message":"Session not found: ses_x"}\nHTTP 404 Not Found\n',
    );

    const failure = await api.messages("ses_x").catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(OpencodeApiError);
    expect(failure).toMatchObject({
      status: 404,
      tag: "SessionNotFoundError",
      message: "Session not found: ses_x",
    });
  });

  it("finds the HTTP status line on stderr too", async () => {
    const { api } = stub(
      '{"_tag":"InvalidRequestError","message":"bad"}',
      "HTTP 400 Bad Request\n",
    );

    await expect(api.prompt("ses_x", "hi")).rejects.toMatchObject({ status: 400, message: "bad" });
  });

  it("scopes the agent list to the repository with the location query, as one argument", async () => {
    const { api, calls } = stub(JSON.stringify({ data: [{ id: "intake" }, { id: "spec" }] }));

    const ids = await api.agentIds();

    expect(ids).toEqual(["intake", "spec"]);
    expect(calls[0]).toEqual(["api", "GET", "/api/agent?location[directory]=%2Frepo%20root"]);
  });

  it("creates a session in the repository directory and returns its id", async () => {
    const { api, calls } = stub(JSON.stringify({ data: { id: "ses_new", agent: "intake" } }));

    expect(await api.createSession({ agent: "intake", title: "Idea" })).toBe("ses_new");
    expect(calls[0]?.slice(0, 3)).toEqual(["api", "POST", "/api/session"]);
    expect(JSON.parse(calls[0]?.[4] ?? "{}")).toEqual({
      agent: "intake",
      title: "Idea",
      location: { directory: "/repo root" },
    });
  });

  it("reads pending forms and treats a form with no state as pending", async () => {
    const { api } = stub(
      JSON.stringify({
        data: [
          {
            id: "frm_1",
            title: "Questions",
            fields: [{ key: "q0", type: "string", options: [{ value: "a", label: "A" }] }],
          },
          { id: "frm_2", state: { status: "answered" }, fields: [] },
        ],
      }),
    );

    const forms = await api.forms("ses_a");

    expect(forms.map((f) => [f.id, f.pending])).toEqual([
      ["frm_1", true],
      ["frm_2", false],
    ]);
    expect(forms[0]?.fields[0]?.choices).toEqual([{ value: "a", label: "A" }]);
  });
});
