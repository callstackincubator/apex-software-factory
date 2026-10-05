import type {
  ChatField,
  ChatForm,
  ChatMessage,
  ChatPart,
  ChatStart,
  ChatState,
  ChatToolCall,
  FormValue,
  SpecRow,
} from "../shared/schema.ts";
import type { OpencodeApi, RawContent, RawForm, RawMessage } from "./opencode-api.ts";

/** What the page may ask of a chat. `chat.ts` is the only place that knows agents and commands. */
export interface ChatService {
  start(request: ChatStart): Promise<{ sessionId: string }>;
  state(sessionId: string): Promise<ChatState>;
  send(sessionId: string, text: string): Promise<void>;
  answer(sessionId: string, formId: string, answer: Record<string, FormValue>): Promise<void>;
  stop(sessionId: string): Promise<void>;
}

/** The role cannot be started: OpenCode lacks its agent. */
export class ChatRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatRefusal";
  }
}

/** Not a session this console process started. */
export class ChatNotFound extends Error {
  constructor(id: string) {
    super(`no chat ${id}`);
    this.name = "ChatNotFound";
  }
}

/** A session id as OpenCode names it; nothing else is ever put in a path. */
export const SESSION_ID = /^ses_[A-Za-z0-9]+$/;

interface Role {
  agent: string;
  title: string;
  /** The slash command that opens the conversation. */
  kickoff: { name: string; text: string };
}

/** The roles the page can start. The page names a role; it never names an agent or a command. */
export function roleFor(request: ChatStart, kind: SpecRow["kind"] = "feature"): Role {
  switch (request.role) {
    case "intake":
      return { agent: "intake", title: "Idea · console", kickoff: { name: "intent", text: "" } };
    case "spec": {
      const { issue, mode } = request;
      // A request's business spec is the skill's "create a feature" mode: the bare issue number.
      const text =
        mode === "technical"
          ? `${issue} technical`
          : kind === "request"
            ? String(issue)
            : `${issue} business`;
      return { agent: "spec", title: `Spec #${issue} · ${mode}`, kickoff: { name: "spec", text } };
    }
  }
}

export function createChatService(options: {
  api: OpencodeApi;
  /** The issue's row if it waits in a Specs queue now; a spec session starts on no other issue. */
  specRow?: (issue: number) => Promise<SpecRow | null>;
}): ChatService {
  const { api } = options;
  // `kickoffId`: the command's own prompt, written by its skill, which the visitor did not type.
  const sessions = new Map<string, { kickoffId: string | null }>();
  let agents: Set<string> | null = null;

  // Only a session this process started may be used: the one place that decides it.
  const known = (id: string) => {
    const session = SESSION_ID.test(id) ? sessions.get(id) : undefined;
    if (session === undefined) throw new ChatNotFound(id);
    return session;
  };

  return {
    async start(request) {
      let kind: SpecRow["kind"] = "feature";
      if (request.role === "spec") {
        const row = (await options.specRow?.(request.issue)) ?? null;
        if (row === null) throw new ChatRefusal(`#${request.issue} is not waiting for a spec`);
        if (row.kind === "request" && request.mode === "technical") {
          throw new ChatRefusal(`#${request.issue} is a request: it needs a business spec first`);
        }
        kind = row.kind;
      }
      const role = roleFor(request, kind);
      // OpenCode accepts an unknown agent name silently, so check it exists first.
      if (agents === null || !agents.has(role.agent)) agents = new Set(await api.agentIds());
      if (!agents.has(role.agent)) {
        throw new ChatRefusal(`OpenCode has no agent "${role.agent}" in this repository`);
      }
      const sessionId = await api.createSession({ agent: role.agent, title: role.title });
      sessions.set(sessionId, { kickoffId: null });
      try {
        await api.command(sessionId, role.kickoff.name, role.kickoff.text);
      } catch (error) {
        sessions.delete(sessionId);
        await api.remove(sessionId).catch(() => {});
        throw error;
      }
      return { sessionId };
    },
    async state(id) {
      const session = known(id);
      const [messages, forms, permissions] = await Promise.all([
        api.messages(id),
        api.forms(id),
        api.permissionCount(id).catch(() => 0),
      ]);
      session.kickoffId ??= messages.find((m) => m.type === "user")?.id ?? null;
      return normalize(messages, forms, permissions, session.kickoffId);
    },
    async send(id, text) {
      known(id);
      await api.prompt(id, text);
    },
    async answer(id, formId, answer) {
      known(id);
      await api.replyForm(id, formId, answer);
    },
    async stop(id) {
      known(id);
      await api.interrupt(id);
    },
  };
}

function clip(text: string, max = 90): string {
  const line = (text.split("\n")[0] ?? "").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function inputString(part: RawContent, ...keys: string[]): string | undefined {
  const input = part.state?.input;
  for (const key of keys) {
    const value = input?.[key];
    if (typeof value === "string" && value !== "") return value;
  }
  return undefined;
}

/** One muted line for a tool call: what it did, not what it returned. */
export function toolSummary(part: RawContent): string {
  const name = part.name ?? "tool";
  if (name === "skill") return `loaded skill ${inputString(part, "id", "name") ?? ""}`.trim();
  if (name === "bash") return clip(inputString(part, "command") ?? "shell command");
  const target = inputString(part, "filePath", "path", "pattern", "url", "description", "query");
  return target === undefined ? name : `${name} ${clip(target)}`;
}

function toolStatus(part: RawContent): ChatToolCall["status"] {
  const status = part.state?.status;
  return status === "completed" || status === "error" ? status : "running";
}

/** Tools whose question is shown as a form, so a line for them would say the same twice. */
const HIDDEN_TOOLS = new Set(["question"]);

function partsOf(message: RawMessage): ChatPart[] {
  const parts: ChatPart[] = [];
  for (const part of message.parts) {
    if (part.type === "text" && (part.text ?? "").trim() !== "") {
      parts.push({ kind: "text", text: part.text ?? "" });
    } else if (part.type === "tool" && !HIDDEN_TOOLS.has(part.name ?? "")) {
      parts.push({
        kind: "tool",
        tool: { name: part.name ?? "tool", status: toolStatus(part), summary: toolSummary(part) },
      });
    }
    // Reasoning and content types this console does not know stay out.
  }
  return parts;
}

const FIELD_TYPES = new Set(["string", "number", "integer", "boolean", "multiselect"]);

function formOf(form: RawForm): ChatForm {
  const fields: ChatField[] = form.fields
    .filter((field) => field.hidden !== true)
    .map((field) => ({
      key: field.key,
      ...(field.title === undefined ? {} : { title: field.title }),
      ...(field.description === undefined ? {} : { description: field.description }),
      required: field.required === true,
      // A field type this console does not know (such as an external link) is asked as text.
      type: FIELD_TYPES.has(field.type) ? (field.type as ChatField["type"]) : "string",
      options: field.choices.map((o) => ({
        value: o.value,
        label: o.label ?? o.value,
        ...(o.description === undefined ? {} : { description: o.description }),
      })),
      custom: field.custom === true,
      ...(field.placeholder === undefined ? {} : { placeholder: field.placeholder }),
    }));
  return { id: form.id, title: form.title, fields };
}

/** Turns OpenCode's messages and forms (oldest first) into what the page shows. */
export function normalize(
  raw: RawMessage[],
  rawForms: RawForm[],
  permissions: number,
  hiddenUserId: string | null,
): ChatState {
  const messages: ChatMessage[] = [];
  for (const message of raw) {
    if (message.type === "user") {
      if (message.id === hiddenUserId) continue;
      if ((message.text ?? "").trim() !== "") {
        messages.push({
          id: message.id,
          role: "user",
          parts: [{ kind: "text", text: message.text ?? "" }],
        });
      }
    } else if (message.type === "assistant") {
      const parts = partsOf(message);
      if (parts.length > 0) messages.push({ id: message.id, role: "agent", parts });
    }
  }
  const last = raw.at(-1);
  const forms = rawForms.filter((form) => form.pending).map(formOf);
  const failed = last?.type === "idle" && (last.outcome === "failed" || last.outcome === "error");
  return {
    messages,
    forms,
    permissionPending: permissions > 0,
    running: last !== undefined && last.type !== "idle",
    failure: failed ? "The agent stopped with an error. Send a message to try again." : null,
  };
}
