import type { z } from "zod";
import { HealthResponse } from "./health.ts";

export type ApiClientOptions = {
  /** Origin of the API, e.g. `http://localhost:3001`. No trailing slash needed. */
  baseUrl: string;
  fetch?: typeof globalThis.fetch;
};

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** A typed client for the API. Every response is parsed with its contract schema. */
export function createApiClient({ baseUrl, fetch = globalThis.fetch }: ApiClientOptions) {
  const origin = baseUrl.replace(/\/+$/, "");

  async function get<S extends z.ZodType>(path: string, schema: S): Promise<z.infer<S>> {
    const response = await fetch(`${origin}${path}`, { headers: { accept: "application/json" } });
    if (!response.ok) {
      throw new ApiError(response.status, `GET ${path} failed with ${response.status}`);
    }
    return schema.parse(await response.json());
  }

  return {
    health: () => get("/health", HealthResponse),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
