import { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "./context.ts";
import { validationHook } from "./errors.ts";

/** Every route module builds its routes on one of these, so validation errors share one shape. */
export function createRouter() {
  return new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
}
