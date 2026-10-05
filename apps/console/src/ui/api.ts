import { z } from "zod";
import {
  AutomationDetail,
  AutomationsResponse,
  DeliveryDetail,
  ErrorBody,
  OpencodeResponse,
  RunResponse,
  Snapshot,
  type Window,
} from "../shared/schema.ts";

async function getJson<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  const res = await fetch(path, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(await reason(res));
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
  if (!res.ok) throw new Error(await reason(res));
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
