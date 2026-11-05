# 0026 — The product API runs on Cloudflare Workers

Status: Accepted

Amends [0002](0002-hono-on-node-for-http-services.md): the product API no
longer runs on Node in production. The OTA server is unchanged.

## Context

The factory is moving off a self-hosted booth laptop onto GitHub-hosted
runners and third-party services. The mobile app runs on cloud simulators, so
the product API (`apps/api`) must be reachable over the public internet, and
it must cost nothing. The API is small: stateless, JSON, no database yet.

Hosts considered:

- **Vercel Hobby** is for non-commercial use only.
- **Render's free tier** is not meant for production and sleeps when idle.
- **Fly.io** has no free tier.
- **Cloudflare Workers** has a free plan with a `workers.dev` subdomain, no
  idle sleep, and preview URLs per uploaded version.

## Decision

1. **`apps/api` is deployed as a Cloudflare Worker** named `apex-api` on the
   free plan, at its `workers.dev` address. No custom domain.
2. **Two entry points, one app.** `src/worker.ts` exports `{ fetch }` built
   from `createApp`; `src/main.ts` stays for local Node development. Both
   build the same app from a `Config`.
3. **Configuration splits.** `loadConfig(env)` holds what every runtime needs
   (`LOG_LEVEL`, `APP_VERSION`); `loadNodeConfig()` adds `PORT`, `HOST` and
   `SHUTDOWN_TIMEOUT_MS`. The Worker passes its `env` bindings to
   `loadConfig`; nothing in its path touches `process.env` or `node:fs`.
4. **The version is bundled.** `package.json` is imported as JSON instead of
   read from disk at startup.
5. **pino stays.** It bundles for workerd without `nodejs_compat`; wrangler
   resolves its browser build, which logs through `console` (objects, not JSON
   lines), and Workers Logs keeps those fields. The flag is not set.
6. **Deploys come from CI.** `.github/workflows/api-deploy.yml` runs
   `wrangler deploy` on a push to `main` that touches `apps/api`, `packages`
   or the lockfile. A pull request uploads a version with
   `wrangler versions upload --preview-alias pr-<number>` and comments the
   preview URL. A pull request from a fork has no secrets and is skipped.
   The repository secrets are `CLOUDFLARE_API_TOKEN` and
   `CLOUDFLARE_ACCOUNT_ID`.
7. **The Dockerfile stays**, for anyone who wants the Node build; nothing
   deploys it.

## Consequences

- Free plan limits apply: 100,000 requests per day and 10 ms CPU per
  request. A booth day is far below the first; a handler that needs more CPU
  (large OpenAPI generation, heavy validation) must be reworked or the plan
  upgraded.
- Code in `apps/api` must run in workerd: Web APIs and Hono, no `node:*`
  imports unless `nodejs_compat` is added deliberately.
- In-memory state does not survive between requests. `uptimeSeconds` on
  `/health` counts from isolate start, not process start.
- The mobile app needs the `workers.dev` URL as its API base URL.
- Persistence, when it comes, uses a Cloudflare binding (D1, KV) and needs a
  new record.
