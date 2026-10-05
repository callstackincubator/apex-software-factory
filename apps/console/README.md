# @apex/console

The factory console: a web page, run locally by the maintainer, that shows the
factory's workers, every pending delivery with its time per phase, the review
statistics and the GitHub workflows, and that can start a factory run or open
OpenCode. It is host tooling, not product. Specification:
[docs/internal/CONSOLE.md](../../docs/internal/CONSOLE.md); decision:
[ADR 0016](../../docs/internal/adr/0016-a-local-factory-console.md).

## Run it

```bash
pnpm console                       # from the repository root: builds the page, serves it
pnpm console --demo                # sample data: no gh, no OpenCode database
pnpm --filter @apex/console dev    # server with --watch, and Vite on :5173 proxying /api
```

Open <http://127.0.0.1:4280>. It needs, for real data, `gh` logged in (as a
user who can see the repository's Actions) and, for phases and findings, the
OpenCode v2 database. The Memory tab reads the `factory-memory` branch with
`git` (read-only: a fetch of that branch and plumbing, never a checkout or a
push). Each source is optional: when one fails, the page says
which and why, and shows the rest.

## Configuration

Environment variables, read once in `src/server/config.ts`:

| Variable           | Default                                            |
| ------------------ | -------------------------------------------------- |
| `CONSOLE_PORT`     | `4280`                                             |
| `CONSOLE_HOST`     | `127.0.0.1` (also `localhost`, `::1`)              |
| `CONSOLE_REPO`     | `owner/name`, else from `gh repo view`             |
| `OPENCODE_DB`      | `~/.local/share/opencode/opencode.db`              |
| `FACTORY_RUN_LOGS` | `:`-separated run-log directories, else discovered |
| `CONSOLE_DEMO`     | off; `--demo` turns it on                          |

## What it writes

Only four things, all of which a person already does: dispatch `factory.yml`
for an issue (**Start run**), dispatch another workflow on the default branch
(**Run now**, only one with `workflow_dispatch` and no required input), run
`opencode pair` to open OpenCode's web app, and, on the **Ideas** and **Specs**
tabs, create OpenCode sessions on the `intake` and `spec` agents and send
messages to them (through `opencode api`; the agents file or edit issues, the
`intake` one only when the visitor says yes).
Everything else is read-only. It
answers only loopback `Host` headers, and a `POST` only with its own `Origin`.

## Tests

`pnpm --filter @apex/console test` (Vitest). Server tests run in Node against
temporary SQLite files and a stubbed `gh`; page tests run in jsdom.
