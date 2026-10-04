# 0006 — Source-shipping packages are installed, not deployed; the OTA server is exempt from the OpenAPI rule

Status: Accepted

## Context

Building the first services surfaced two conflicts with earlier records.

1. ADR 0001 ships workspace packages as TypeScript source. `pnpm deploy` copies
   them under `node_modules`, and Node refuses to strip types there
   (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`), so a deployed service
   cannot start.
2. ADR 0002 asks every HTTP service to serve `/openapi.json` and `/docs`. The
   OTA server only mounts hot-updater's own handler; its surface is defined
   and documented upstream, and only the hot-updater CLI and SDK call it.

## Decision

1. Container images install production dependencies with
   `pnpm install --prod --filter "<pkg>..."` inside the workspace layout and
   run from the workspace path. `pnpm deploy` is not used.
2. ADR 0002's OpenAPI and `/docs` requirement applies to product APIs
   (`apps/api`). `apps/ota-server` is release infrastructure and is exempt;
   it still follows the rest of ADR 0002 (Hono, app/main split, zod config,
   in-process tests, graceful shutdown).

## Consequences

Images are slightly larger than a deployed bundle. Any new service that only
wraps a third-party handler states in its README which upstream document
describes its surface.
