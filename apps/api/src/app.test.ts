import { ErrorResponse, HealthResponse } from "@apex/contract";
import { createRoute } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { createLogger } from "./logger.ts";

function makeApp() {
  const config = loadConfig({ APP_VERSION: "9.9.9-test" });
  return createApp({ config, logger: createLogger("silent") });
}

describe("GET /health", () => {
  it("returns a contract-valid HealthResponse carrying the configured version", async () => {
    const res = await makeApp().request("/health");

    expect(res.status).toBe(200);
    const body = HealthResponse.parse(await res.json());
    expect(body.version).toBe("9.9.9-test");
  });

  it("echoes a caller-supplied x-request-id", async () => {
    const res = await makeApp().request("/health", { headers: { "x-request-id": "booth-42" } });

    expect(res.headers.get("x-request-id")).toBe("booth-42");
  });

  it("allows cross-origin calls from the Expo web client", async () => {
    const res = await makeApp().request("/health", {
      headers: { origin: "http://localhost:8081" },
    });

    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
});

describe("GET /openapi.json", () => {
  it("documents GET /health with the contract's HealthResponse schema", async () => {
    const res = await makeApp().request("/openapi.json");

    expect(res.status).toBe(200);
    const doc = await res.json();
    expect(doc.info.version).toBe("9.9.9-test");
    expect(doc.paths["/health"].get.responses["200"].content["application/json"].schema).toEqual({
      $ref: "#/components/schemas/HealthResponse",
    });
    expect(doc.components.schemas.HealthResponse.required).toEqual([
      "status",
      "version",
      "uptimeSeconds",
    ]);
  });
});

describe("GET /docs", () => {
  it("serves the API reference page pointing at /openapi.json", async () => {
    const res = await makeApp().request("/docs");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    expect(await res.text()).toContain("/openapi.json");
  });
});

describe("errors", () => {
  it("answers an unknown route with a 404 ErrorResponse coded not_found", async () => {
    const res = await makeApp().request("/no-such-route", {
      headers: { "x-request-id": "req-404" },
    });

    expect(res.status).toBe(404);
    const body = ErrorResponse.parse(await res.json());
    expect(body.error.code).toBe("not_found");
    expect(body.error.requestId).toBe("req-404");
  });

  it("turns an unhandled exception into an opaque 500 ErrorResponse", async () => {
    const app = makeApp();
    app.get("/boom", () => {
      throw new Error("database password is hunter2");
    });

    const res = await app.request("/boom");

    expect(res.status).toBe(500);
    const body = ErrorResponse.parse(await res.json());
    expect(body.error.code).toBe("internal_error");
    expect(JSON.stringify(body)).not.toContain("hunter2");
  });

  it("rejects a request that fails its route's schema with a 400 validation_failed", async () => {
    const app = makeApp();
    app.openapi(
      createRoute({
        method: "get",
        path: "/square",
        request: { query: z.object({ n: z.coerce.number() }) },
        responses: { 200: { description: "ok" } },
      }),
      (c) => c.json({ square: c.req.valid("query").n ** 2 }, 200),
    );

    const res = await app.request("/square?n=abc");

    expect(res.status).toBe(400);
    const body = ErrorResponse.parse(await res.json());
    expect(body.error.code).toBe("validation_failed");
    expect(body.error.details).toEqual([expect.objectContaining({ path: ["n"] })]);
  });

  it("maps a thrown HTTPException to an ErrorResponse with its status", async () => {
    const app = makeApp();
    app.get("/teapot", () => {
      throw new HTTPException(409, { message: "Proposal already exists." });
    });

    const res = await app.request("/teapot");

    expect(res.status).toBe(409);
    expect(ErrorResponse.parse(await res.json()).error).toMatchObject({
      code: "conflict",
      message: "Proposal already exists.",
    });
  });
});
