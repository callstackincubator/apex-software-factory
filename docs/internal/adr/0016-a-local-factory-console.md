# 0016 — A local, read-mostly factory console

Status: Accepted

## Context

Watching the factory today means reading GitHub (labels, the PR's Status
line, handoff comments), the Actions tab (which runner holds which issue) and,
for anything finer, OpenCode's database and the run logs on the booth laptop.
Nothing shows how long each stage took, how many review findings were real,
or whether both `factory` runners are busy. Starting a run means setting a
label in the browser or typing `opencode` in a terminal.

The maintainer wants one page that shows the workers, every pending delivery
with its time per phase, and the review statistics, and that can start a
factory run or an interactive OpenCode session. It runs on the maintainer's
own machine (the booth laptop, or a laptop with the same login). It is never
hosted.

## Decision

1. **A new workspace app, `apps/console` (`@apex/console`).** It is host
   tooling, like `apps/ota-server` is release infrastructure: not product.
   No product app imports it and it imports no app (architecture rule 1).
   Its full specification is [CONSOLE.md](../CONSOLE.md).

2. **Hono on Node serves a React page built with Vite.** The server follows
   ADR 0002 and architecture rule 4 (`app.ts` builds, `main.ts` listens). The
   page is React and TypeScript, built by Vite into `apps/console/dist` and
   served by the same process. That build is owned by the app, as rule 5
   allows: the server runs from source by type stripping; only the page is
   bundled. Fonts and charts are bundled; nothing is fetched from the
   internet at runtime.

3. **Its wire shapes are the app's own, not the contract's.** The console's
   JSON never leaves the machine and is read only by its own page, so its zod
   schemas live in `apps/console/src/shared/` and both the server and the page
   import them from there. `@apex/contract` stays the product's contract.
   This is the same kind of exemption ADR 0006 gave the OTA server.

4. **It reads what the factory already writes, and changes none of it.**
   - GitHub, through the maintainer's own `gh` login (`gh api`): the
     `factory` runners, the factory workflow's runs and jobs, the open issues
     with an agent label, their `<kind>/<n>` PRs (Status line, `## Review`,
     labels).
   - OpenCode's SQLite database, opened read-only with `node:sqlite`: every
     run's sessions and subagent sessions give the phase timeline, and the
     `review-verifier`'s report block gives the findings.
   - The run logs' `.stopped` files under `.worktrees/factory-runs/`: the
     watchdog's stops.

   No skill, agent, script or workflow changes for it. A console that is down
   or wrong cannot stop a delivery.

5. **It writes in exactly two ways, both ones a person already has.**
   - **Start a factory run** dispatches `factory.yml` for an issue
     (`gh workflow run`), which is what `issue-state.yml` does; the workflow's
     own "Check who asked" step still decides.
   - **Open OpenCode** starts `opencode web` on the loopback interface in the
     repository root, the same as typing it, and links to it.

   Nothing else: no labels, comments, merges, or simlock operations.

6. **Loopback only.** The server binds `127.0.0.1` and its config refuses any
   other host. It answers only requests whose `Host` is a loopback name on its
   port, and a `POST` only when its `Origin` is the console's own. It holds no
   token: `gh` holds the login. This is what keeps a page that can start
   runs, with the maintainer's credentials behind it, off the booth network
   (safety rule 6).

## Consequences

- One more app in `pnpm check`: its typecheck, lint, format and tests run in
  CI like every other package. Its tests build a temporary OpenCode database
  for both schema versions it supports and stub `gh`.
- OpenCode's database is not a public interface. The console detects the
  tables and columns it needs at start and shows "OpenCode data unavailable"
  with the reason instead of failing; the GitHub half keeps working.
- The console's look follows the Callstack console style (simlock's
  `docs/internal/DESIGN.md`) with Apex's green as the accent.
