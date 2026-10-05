import { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "./context.ts";
import { validationHook } from "./errors.ts";

export function createRouter() {
  return new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
}
