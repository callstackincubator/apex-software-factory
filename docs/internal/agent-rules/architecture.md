# Agent rules: architecture

Rules for anyone (human or agent) writing code in this monorepo. They restate
the boundaries ADRs 0001–0003 set, as checks a reviewer can apply to a diff.
Violating one is grounds for rejecting a change even if it works.

1. **Apps never import each other.** `apps/mobile`, `apps/api` and
   `apps/ota-server` depend on `packages/*` and on npm packages, never on
   another app — not by workspace name, not by relative path. Code two apps
   need moves into a package.

2. **The contract comes first.** Every request and response shape lives as a
   zod schema in `packages/contract` (`@apex/contract`). A feature that crosses
   the wire changes the contract first, then the API route that validates
   against it, then the screen that parses the response with it — in that
   order, in one PR. Neither side declares its own copy of a wire type.

3. **The mobile app never imports `apps/api`.** It reaches the API only over
   HTTP, through the typed client in `@apex/contract`, and treats every
   response as unparsed until the contract schema accepts it. Nothing
   server-side (`hono`, `pino`, `node:*`) appears in the app's dependency
   graph.

4. **A Hono service splits `app` from `main`.** `src/app.ts` builds and exports
   the Hono app and starts nothing; tests import it and call `app.request()`.
   `src/main.ts` alone reads the environment, opens the port, and drains on
   SIGTERM. Tests never import `main.ts`. Routes are declared with
   `@hono/zod-openapi` using contract schemas, so `/openapi.json` stays true.

5. **No transpile step.** Node runs TypeScript by type stripping; packages
   export `src/*.ts`; relative imports carry the `.ts` extension. Only
   erasable syntax: no `enum`, `namespace`, or constructor parameter
   properties. A package that needs a build owns it locally (the mobile app's
   native build is the only one).

6. **Configuration is read once, validated, and fails fast.** A service reads
   `process.env` in its config module only, parses it with zod at startup, and
   exits with a clear message on a bad value. No other module reads the
   environment. The mobile app gets its configuration from Expo's public
   config, never from a secret.

7. **The OTA server is release infrastructure, not product.** A product
   feature never changes `apps/ota-server`, and the product API never serves
   update bundles. The app talks to the OTA server only through
   `@hot-updater/react-native`.

8. **A rule is enforced in exactly one place.** Never implement the same
   decision twice — not in two modules, not on two paths through one module,
   not once in the route and once in the screen. Validation lives in the
   contract schema; both sides call it. Duplicated enforcement diverges
   silently, because each copy keeps passing its own tests. When a review
   finding says "and the same check elsewhere needs updating too", the
   duplication is the finding.

9. **A dependency is a decision.** Prefer what the workspace already has. Add
   one with `pnpm --filter <package> add`, never by editing the lockfile;
   resolve a `pnpm-lock.yaml` conflict by rebasing and running
   `pnpm install`. A new app dependency can carry native code, which makes
   the change native (delivery rule 17).

10. **A claim in a comment is part of the change.** If a change makes a nearby
    comment, doc paragraph or test name false, fix or delete it in the same
    commit. Verify a strong claim in a comment against the code before relying
    on it, and treat one that is no longer true as a defect you found.
