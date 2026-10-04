import { createApiClient } from "@apex/contract";

/** Where the API lives. Set `EXPO_PUBLIC_API_URL` to the booth laptop's LAN address on a device. */
export const apiBaseUrl = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3001";

export const api = createApiClient({ baseUrl: apiBaseUrl });
