import { z } from "zod";
import {
  AutomationDetail,
  AutomationsResponse,
  ChatState,
  ChatStarted,
  type ChatStart,
  type FormValue,
  DeliveryDetail,
  ErrorBody,
  OpencodeResponse,
  RunResponse,
  Snapshot,
  type Window,
} from "../shared/schema.ts";

/** A failed call: the server's reason, and its HTTP status, for a page that acts on a 404. */
export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function getJson<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  const res = await fetch(path, { headers: { accept: "application/json" } });
  if (!res.ok) throw new ApiError(res.status, await reason(res));
  return schema.parse(await res.json());
}

async function reason(res: Response): Promise<string> {
  const body = ErrorBody.safeParse(await res.json().catch(() => null));
  return body.success ? body.data.error : `${res.status} ${res.statusText}`;
}

export const fetchSnapshot = (window: Window) =>
  getJson(`/api/snapshot?window=${window}`, Snapshot);

export const fetchDelivery = (issue: number) => getJson(`/api/deliveries/${issue}`, DeliveryDetail);

async function post<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, await reason(res));
  return schema.parse(await res.json());
}

/** Starts a factory run; rejects with the refusal's reason. */
export const startRun = (issue: number) => post("/api/runs", { issue }, RunResponse);

export const fetchAutomations = () => getJson("/api/automations", AutomationsResponse);

export const fetchAutomation = (file: string) =>
  getJson(`/api/automations/${encodeURIComponent(file)}`, AutomationDetail);

/** Runs a workflow on the default branch; rejects with the refusal's reason. */
export const dispatchAutomation = (file: string) =>
  post(
    `/api/automations/${encodeURIComponent(file)}/dispatch`,
    {},
    z.object({ dispatched: z.literal(true) }),
  );

export const startOpencode = () => post("/api/opencode", {}, OpencodeResponse);

export const startChat = (start: ChatStart) => post("/api/chat", start, ChatStarted);

export const fetchChat = (id: string) => getJson(`/api/chat/${id}`, ChatState);

const Accepted = z.unknown();

export const sendChatMessage = (id: string, text: string) =>
  post(`/api/chat/${id}/message`, { text }, Accepted);

export const answerChatForm = (id: string, form: string, answer: Record<string, FormValue>) =>
  post(`/api/chat/${id}/form/${encodeURIComponent(form)}`, { answer }, Accepted);

export const stopChat = (id: string) => post(`/api/chat/${id}/stop`, {}, Accepted);
