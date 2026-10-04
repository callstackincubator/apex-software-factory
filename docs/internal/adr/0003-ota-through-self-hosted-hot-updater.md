# 0003 — OTA updates through a self-hosted hot-updater server

Status: Accepted

## Context

The showcase ends with a merged feature appearing on a phone at the booth
within minutes, without an app store. Everything must run on the booth laptop.

## Decision

- The mobile app uses hot-updater (`@hot-updater/react-native`) with the
  Expo build plugin, in a dev-client / release build (hot-updater does not run
  in Expo Go or in dev mode).
- `apps/ota-server` is a Hono app mounting `@hot-updater/server` with the
  Kysely adapter on SQLite and S3-compatible storage served by MinIO from
  `infra/docker-compose.yml`. Management routes are behind a bearer token.
- Update strategy is **fingerprint**: a bundle is only offered to binaries
  with the same native fingerprint. A merge that changes native code cannot be
  shipped over the air; the publish job reports "needs a native build" instead.
- Every push to `main` that touches `apps/mobile` or `packages/*` runs
  `ota-publish.yml` on a self-hosted GitHub Actions runner on the booth laptop,
  which deploys to the `production` channel.

## Consequences

The OTA server is release infrastructure, separate from the product API. The
booth laptop must have Docker running and the runner online for merges to
reach devices.
