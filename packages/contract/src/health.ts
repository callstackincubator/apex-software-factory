import { z } from "zod";

/** `GET /health` — liveness of the API, read by the mobile app and by monitoring. */
export const HealthResponse = z.object({
  status: z.literal("ok"),
  version: z.string(),
  uptimeSeconds: z.number().nonnegative(),
});
export type HealthResponse = z.infer<typeof HealthResponse>;
