import { z } from "zod";

export const ErrorResponse = z
  .object({
    error: z.object({
      code: z.string().describe("Stable snake_case code, e.g. not_found or validation_failed."),
      message: z.string().describe("Safe to show; never contains internals."),
      requestId: z.string().optional().describe("Echoes the x-request-id response header."),
      details: z.unknown().optional().describe("Extra context, e.g. failed validation issues."),
    }),
  })
  .meta({ id: "ErrorResponse", description: "Body of every non-2xx JSON response." });
export type ErrorResponse = z.infer<typeof ErrorResponse>;
