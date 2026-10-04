import { z } from "zod";

/**
 * The body of every non-2xx JSON response from the API: unknown routes,
 * failed request validation and unhandled errors all share this shape.
 */
export const ErrorResponse = z
  .object({
    error: z.object({
      /** Machine-readable, snake_case, stable: `not_found`, `validation_failed`, `internal_error`… */
      code: z.string(),
      /** Human-readable; safe to show, never contains internals. */
      message: z.string(),
      /** Echoes the `x-request-id` response header, to correlate with server logs. */
      requestId: z.string().optional(),
      /** Extra machine-readable context, e.g. the zod issues of a failed validation. */
      details: z.unknown().optional(),
    }),
  })
  .meta({ id: "ErrorResponse", description: "Body of every non-2xx JSON response." });
export type ErrorResponse = z.infer<typeof ErrorResponse>;
