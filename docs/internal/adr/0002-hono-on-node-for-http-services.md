# 0002 — Hono on Node for every HTTP service

Status: Accepted

## Context

We want a modern, typed HTTP stack that agents can extend without ceremony,
that describes itself (OpenAPI), and that hot-updater's self-hosted server
also supports.

## Decision

- HTTP services use Hono on Node (`@hono/node-server`), Node ≥ 22.18 running
  TypeScript directly through type stripping — no transpile step in dev or prod.
- Routes are declared with `@hono/zod-openapi` using schemas from
  `@apex/contract`; the OpenAPI document is served at `/openapi.json` and a
  reference UI at `/docs`.
- Tests call `app.request()` in-process; no port is opened in unit tests.
- Logs are structured JSON (pino). Configuration comes from environment
  variables validated with zod at startup; a bad config fails fast.
- Every service handles SIGTERM by draining in-flight requests.

## Consequences

The API and the OTA server share one framework, one test style and one way to
run. Anything Node cannot strip (enums, namespaces, parameter properties) is
not used — `erasableSyntaxOnly` enforces it.
