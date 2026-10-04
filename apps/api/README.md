# @apex/api

The product API behind the showcase app: Hono on Node, running TypeScript
directly (no build step), with routes declared from `@apex/contract` schemas.

## Run

```sh
pnpm --filter @apex/api dev     # node --watch src/main.ts
pnpm --filter @apex/api start   # node src/main.ts
pnpm --filter @apex/api test    # vitest, in-process via app.request()
```

Logs are JSON lines on stdout; pipe through `npx pino-pretty` to read them.

Docker, from the repository root:

```sh
docker build -f apps/api/Dockerfile -t apex-api .
docker run --rm -p 3001:3001 apex-api
```

## Environment

| Variable              | Default                   | Notes                                                   |
| --------------------- | ------------------------- | ------------------------------------------------------- |
| `PORT`                | `3001`                    | 1–65535                                                 |
| `HOST`                | `0.0.0.0`                 | All interfaces, so phones on the booth LAN can reach it |
| `LOG_LEVEL`           | `info`                    | `fatal` `error` `warn` `info` `debug` `trace` `silent`  |
| `APP_VERSION`         | `version` in package.json | Reported by `/health` and the OpenAPI document          |
| `SHUTDOWN_TIMEOUT_MS` | `10000`                   | How long SIGTERM/SIGINT waits for in-flight requests    |

An invalid value stops the process at startup with a message naming the variable.

## Endpoints

| Path                | What                                           |
| ------------------- | ---------------------------------------------- |
| `GET /health`       | `HealthResponse` from the contract             |
| `GET /openapi.json` | OpenAPI 3.1 document generated from the routes |
| `GET /docs`         | Scalar API reference for that document         |

Every error (unknown route, failed validation, thrown exception) answers with
the contract's `ErrorResponse`: `{ "error": { "code", "message", "requestId" } }`.
Every response carries an `x-request-id` header, also present in each log line.

## Adding an endpoint

1. Add the request/response schemas to `packages/contract/src/`, with
   `.meta({ id: "Name" })` so they appear as named OpenAPI components, and
   export them from its `index.ts`.
2. Add a route module in `src/routes/` (copy `health.ts`): build routes with
   `createRouter()` and `createRoute()`, list error statuses with
   `errorResponse()`, and throw `HTTPException` for expected failures.
3. Mount it in `src/app.ts` with `app.route("/", yourRoutes(deps))`.
4. Add tests in `src/` that call `app.request()` and parse the body with the
   contract schema.
