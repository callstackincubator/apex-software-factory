import { z } from "zod";
import { OpencodeUnavailable, realExec, type Exec } from "./opencode-cli.ts";

/** OpenCode answered with an error: its HTTP status, its error tag and its message. */
export class OpencodeApiError extends Error {
  readonly status: number;
  readonly tag: string | undefined;
  constructor(status: number, message: string, tag?: string) {
    super(message);
    this.name = "OpencodeApiError";
    this.status = status;
    this.tag = tag;
  }
}

// OpenCode's own wire shapes, read leniently: a field or a content type the console does not
// know is passed over, never a crash. Every output is parsed (safety rule 3).

export const RawContent = z.looseObject({
  type: z.string(),
  text: z.string().optional(),
  name: z.string().optional(),
  state: z
    .looseObject({
      status: z.string().optional(),
      input: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
});
export type RawContent = z.infer<typeof RawContent>;

export const RawMessage = z.looseObject({
  id: z.string(),
  type: z.string(),
  text: z.string().optional(),
  outcome: z.string().optional(),
  content: z.array(z.unknown()).optional(),
});
export type RawMessage = z.infer<typeof RawMessage> & { parts: RawContent[] };

const RawOption = z.looseObject({
  value: z.string(),
  label: z.string().optional(),
  description: z.string().optional(),
});

export const RawField = z.looseObject({
  key: z.string(),
  type: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  required: z.boolean().optional(),
  hidden: z.boolean().optional(),
  options: z.array(z.unknown()).optional(),
  custom: z.boolean().optional(),
  placeholder: z.string().optional(),
});
export type RawField = z.infer<typeof RawField> & { choices: z.infer<typeof RawOption>[] };

export interface RawForm {
  id: string;
  title: string;
  pending: boolean;
  fields: RawField[];
}

const Envelope = z.looseObject({ data: z.unknown() });
const SessionCreated = z.object({ data: z.looseObject({ id: z.string() }) });
const AgentList = z.array(z.looseObject({ id: z.string() }));
const RawFormShape = z.looseObject({
  id: z.string(),
  title: z.string().optional(),
  fields: z.array(z.unknown()).optional(),
  state: z.looseObject({ status: z.string().optional() }).optional(),
});

/** What the console asks of OpenCode. One method per call; all through `opencode api`. */
export interface OpencodeApi {
  agentIds(): Promise<string[]>;
  createSession(input: { agent: string; title: string }): Promise<string>;
  command(session: string, name: string, text: string): Promise<void>;
  prompt(session: string, text: string): Promise<void>;
  /** Oldest first. */
  messages(session: string): Promise<RawMessage[]>;
  forms(session: string): Promise<RawForm[]>;
  replyForm(session: string, form: string, answer: Record<string, unknown>): Promise<void>;
  permissionCount(session: string): Promise<number>;
  interrupt(session: string): Promise<void>;
  remove(session: string): Promise<void>;
}

const STATUS_LINE = /^HTTP (\d{3})\b.*$/m;

function tail(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > 400 ? `…${trimmed.slice(-400)}` : trimmed;
}

/** The JSON body of `opencode api`'s output, or an `OpencodeApiError` for an HTTP error. */
export function parseOutput(stdout: string, stderr = ""): unknown {
  const line = STATUS_LINE.exec(stdout) ?? STATUS_LINE.exec(stderr);
  const body = stdout.replace(STATUS_LINE, "").trim();
  let json: unknown = undefined;
  let parsed = false;
  if (body !== "") {
    try {
      json = JSON.parse(body);
      parsed = true;
    } catch {
      // Handled below.
    }
  }
  const tagged = z
    .looseObject({ _tag: z.string(), message: z.string().optional() })
    .safeParse(json);
  const status = line === null ? undefined : Number(line[1]);
  if ((status !== undefined && status >= 400) || (status === undefined && tagged.success)) {
    const message = tagged.success ? (tagged.data.message ?? tagged.data._tag) : tail(body);
    throw new OpencodeApiError(
      status ?? 500,
      message === "" ? `OpenCode answered HTTP ${status}` : message,
      tagged.success ? tagged.data._tag : undefined,
    );
  }
  if (!parsed) {
    if (body === "") return undefined;
    throw new OpencodeApiError(502, `OpenCode did not answer JSON: ${tail(body)}`);
  }
  return json;
}

/** The query that scopes agent and command lookups to a directory. */
export function locationQuery(directory: string): string {
  return `location[directory]=${encodeURIComponent(directory)}`;
}

/**
 * OpenCode v2's background service, driven only through `opencode api <METHOD> <path>`, which
 * supplies the service's credentials itself: the console never sees them.
 */
export function createOpencodeApi(options: { cwd: string; exec?: Exec }): OpencodeApi {
  const exec = options.exec ?? realExec;

  const call = async (method: string, path: string, body?: unknown): Promise<unknown> => {
    const args = ["api", method, path];
    if (body !== undefined) args.push("-d", JSON.stringify(body));
    let out: { stdout: string; stderr: string };
    try {
      out = await exec("opencode", args, { cwd: options.cwd, timeout: 20_000 });
    } catch (error) {
      const e = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
      if (e.code === "ENOENT") throw new OpencodeUnavailable("opencode is not on PATH");
      // A failed call still prints its error body: an HTTP error is not an unavailable service.
      if (STATUS_LINE.test(e.stdout ?? "") || STATUS_LINE.test(e.stderr ?? "")) {
        return parseOutput(e.stdout ?? "", e.stderr ?? "");
      }
      const said = tail(`${e.stderr ?? ""}\n${e.stdout ?? ""}`);
      throw new OpencodeUnavailable(said === "" ? `opencode api failed: ${e.message}` : said);
    }
    return parseOutput(out.stdout, out.stderr);
  };

  const data = async (method: string, path: string, body?: unknown): Promise<unknown> => {
    const parsed = Envelope.safeParse(await call(method, path, body));
    if (!parsed.success) throw new OpencodeApiError(502, "OpenCode answered an unexpected shape");
    return parsed.data.data;
  };
  const sid = (id: string) => `/api/session/${encodeURIComponent(id)}`;

  return {
    async agentIds() {
      const list = AgentList.safeParse(
        await data("GET", `/api/agent?${locationQuery(options.cwd)}`),
      );
      if (!list.success)
        throw new OpencodeApiError(502, "OpenCode's agent list has an unexpected shape");
      return list.data.map((agent) => agent.id);
    },
    async createSession({ agent, title }) {
      const out = SessionCreated.safeParse(
        await call("POST", "/api/session", { agent, title, location: { directory: options.cwd } }),
      );
      if (!out.success) throw new OpencodeApiError(502, "OpenCode did not return a session");
      return out.data.data.id;
    },
    async command(session, name, text) {
      await call("POST", `${sid(session)}/command`, { name, text });
    },
    async prompt(session, text) {
      await call("POST", `${sid(session)}/prompt`, { text });
    },
    async messages(session) {
      const list = z
        .array(z.unknown())
        .safeParse(await data("GET", `${sid(session)}/message?limit=200`));
      if (!list.success)
        throw new OpencodeApiError(502, "OpenCode's message list has an unexpected shape");
      const messages: RawMessage[] = [];
      for (const item of list.data) {
        const message = RawMessage.safeParse(item);
        if (!message.success) continue;
        const parts: RawContent[] = [];
        for (const raw of message.data.content ?? []) {
          const part = RawContent.safeParse(raw);
          if (part.success) parts.push(part.data);
        }
        messages.push({ ...message.data, parts });
      }
      // The service lists newest first.
      return messages.reverse();
    },
    async forms(session) {
      const list = z.array(z.unknown()).safeParse(await data("GET", `${sid(session)}/form`));
      if (!list.success)
        throw new OpencodeApiError(502, "OpenCode's form list has an unexpected shape");
      const forms: RawForm[] = [];
      for (const item of list.data) {
        const form = RawFormShape.safeParse(item);
        if (!form.success) continue;
        const fields: RawField[] = [];
        for (const raw of form.data.fields ?? []) {
          const field = RawField.safeParse(raw);
          if (!field.success) continue;
          const choices: z.infer<typeof RawOption>[] = [];
          for (const option of field.data.options ?? []) {
            const parsed = RawOption.safeParse(option);
            if (parsed.success) choices.push(parsed.data);
          }
          fields.push({ ...field.data, choices });
        }
        const status = form.data.state?.status;
        forms.push({
          id: form.data.id,
          title: form.data.title ?? "",
          pending: status === undefined || status === "pending",
          fields,
        });
      }
      return forms;
    },
    async replyForm(session, form, answer) {
      await call("POST", `${sid(session)}/form/${encodeURIComponent(form)}/reply`, { answer });
    },
    async permissionCount(session) {
      const list = z.array(z.unknown()).safeParse(await data("GET", `${sid(session)}/permission`));
      return list.success ? list.data.length : 0;
    },
    async interrupt(session) {
      await call("POST", `${sid(session)}/interrupt`);
    },
    async remove(session) {
      await call("DELETE", sid(session));
    },
  };
}
