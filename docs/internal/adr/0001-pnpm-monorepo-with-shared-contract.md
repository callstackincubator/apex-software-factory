# 0001 — A pnpm monorepo with one shared contract package

Status: Accepted

## Context

The showcase has a mobile app and an HTTP API that change together: a feature
proposed at the booth usually needs a screen and an endpoint. Agents deliver
it as one pull request, so both must live in one repository with one check.

## Decision

- One pnpm workspace: `apps/*` for deployables (`mobile`, `api`, `ota-server`),
  `packages/*` for shared code.
- `packages/contract` (`@apex/contract`) owns every request and response shape
  as zod schemas. The API validates against them; the mobile app parses
  responses with them. The mobile app never imports from `apps/api`.
- Packages ship TypeScript source (`exports` points at `src/*.ts`); there is
  no build step between workspace packages. Relative imports carry the `.ts`
  extension.
- One root `pnpm check` runs typecheck, lint (oxlint), format (oxfmt) and tests
  in every package. Lefthook runs format and lint on commit.
- `pnpm-lock.yaml` conflicts are resolved by rebasing and running
  `pnpm install`, never by hand.

## Consequences

A contract change is one edit that both sides typecheck against. Any package
needing a build step (the mobile app's native code) owns it locally.
