import { HealthResponse } from "@apex/contract";
import { createRoute } from "@hono/zod-openapi";
import type { AppDeps } from "../context.ts";
import { errorResponse } from "../errors.ts";
import { createRouter } from "../router.ts";

const getHealth = createRoute({
  method: "get",
  path: "/health",
  tags: ["system"],
  summary: "Liveness of the API",
  responses: {
    200: {
      description: "The API is up.",
      content: { "application/json": { schema: HealthResponse } },
    },
    ...errorResponse(500, "Unexpected server error."),
  },
});

export function healthRoutes({ config }: AppDeps) {
  const startedAt = performance.now();

  return createRouter().openapi(getHealth, (c) =>
    c.json(
      {
        status: "ok" as const,
        version: config.appVersion,
        uptimeSeconds: Math.floor((performance.now() - startedAt) / 1000),
      },
      200,
    ),
  );
}
