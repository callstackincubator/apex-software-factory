import { Scalar } from "@scalar/hono-api-reference";
import { cors } from "hono/cors";
import { requestId } from "hono/request-id";
import type { AppDeps } from "./context.ts";
import { createErrorHandler, handleNotFound } from "./errors.ts";
import { requestLogger } from "./middleware/request-logger.ts";
import { createRouter } from "./router.ts";
import { healthRoutes } from "./modules/health/index.ts";

export function createApp(deps: AppDeps) {
  const app = createRouter();

  app.use(requestId());
  app.use(requestLogger(deps.logger));
  // The Expo web and dev clients call the API from other origins.
  app.use(cors());

  app.route("/", healthRoutes(deps));

  app.notFound(handleNotFound);
  app.onError(createErrorHandler(deps.logger));

  app.doc31("/openapi.json", {
    openapi: "3.1.0",
    info: {
      title: "Apex API",
      version: deps.config.appVersion,
      description: "The product API behind the Apex Software Factory showcase app.",
    },
  });
  app.get("/docs", Scalar({ url: "/openapi.json", pageTitle: "Apex API" }));

  return app;
}

export type App = ReturnType<typeof createApp>;
