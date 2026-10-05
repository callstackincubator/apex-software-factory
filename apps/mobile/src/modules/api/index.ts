import { type ApiClient, createApiClient } from "@apex/contract";

export const apiBaseUrl = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3001";

let current: ApiClient | null = null;

export function getApiClient(): ApiClient {
  current ??= createApiClient({ baseUrl: apiBaseUrl });
  return current;
}

export function setApiClient(next: ApiClient): void {
  current = next;
}

export function createFakeApiClient(respond: (request: Request) => Promise<Response>): ApiClient {
  return createApiClient({
    baseUrl: "http://api.test",
    fetch: (input, init) => respond(new Request(input, init)),
  });
}

export type { ApiClient } from "@apex/contract";
