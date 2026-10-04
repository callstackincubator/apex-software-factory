# Agent guide

Apex Software Factory is a showcase of an AI-native delivery line. Booth
visitors at reactCon Berlin (Oct 7–9, 2026) describe an idea for an
almost-empty Expo app; it becomes product requirements, a developer writes the
technical spec, and agents implement, test, review and merge it unattended —
the merge ships an over-the-air update to the phone at the booth.

The factory runs on **OpenCode with one model**, `callstack.ai/callstack/Apex`,
set once in `opencode.json` (ADR 0004). No agent, command or skill names a
model. This file is the single entry point for every agent and every tool.

## Layout

| Path                | What                                                                     |
| ------------------- | ------------------------------------------------------------------------ |
| `apps/mobile`       | Expo app (expo-router, hot-updater, Jest). `@apex/mobile`                |
| `apps/api`          | Product HTTP API, Hono on Node. `@apex/api`                              |
| `apps/ota-server`   | Self-hosted hot-updater server — release infrastructure, not product     |
| `packages/contract` | Every wire shape as zod schemas, plus the typed client. `@apex/contract` |
| `docs/internal/`    | ADRs, agent rules, delivery manual, spec templates                       |
| `.agents/`          | Skills (`skills/<name>/SKILL.md`) and helper scripts (`scripts/`)        |
| `.opencode/`        | Subagents and primary agents (`agent/`), slash commands (`command/`)     |
| `.worktrees/`       | Agent worktrees, one per branch (gitignored)                             |

## Commands

```bash
pnpm install                         # Node >= 22.18, pnpm pinned by packageManager
pnpm check                           # typecheck, lint, format check, every package's tests
pnpm format                          # fix formatting (oxfmt)
pnpm --filter @apex/api test         # one package; also @apex/mobile, @apex/contract
pnpm --filter <package> add <dep>    # never edit the lockfile by hand
```

Lefthook runs format and lint on commit. Never pass `--no-verify`.

## Binding rules — read before writing code

Accepted ADRs in [docs/internal/adr/](docs/internal/adr/) and the rules in
[docs/internal/agent-rules/](docs/internal/agent-rules/) are binding:

- [architecture.md](docs/internal/agent-rules/architecture.md) — monorepo
  boundaries and the contract-first order.
- [testing.md](docs/internal/agent-rules/testing.md) — what makes a test worth
  keeping, and where each kind lives.
- [documentation.md](docs/internal/agent-rules/documentation.md) — end-user
  docs versus `docs/internal/`.
- [safety.md](docs/internal/agent-rules/safety.md) — secrets, downloads, OTA,
  the booth laptop, visitors' data.
- [delivery.md](docs/internal/agent-rules/delivery.md) — GitHub Issues as spec
  and queue, labels, claims, handoffs, reviews, the merge gate, native changes.

This file only points at those rules; it does not restate them. It is loaded
into every agent's context, including the spec reviewer, which must stay
blind to the rules — keep it that way.

## The delivery flow

1. A visitor's idea becomes a `request:new` issue, in their words (`/intent`
   with a facilitator, or the issue form).
2. The product owner turns it into the business sections of a `feature:spec`
   issue (`/spec <n>`).
3. A developer writes the Technical spec (`/spec <n> technical`) and sets
   `feature:ready` — the signature that allows unattended delivery.
4. `/deliver <n>` claims it, splits it into tasks if the spec lists them, and
   per issue: implements tests-first in a worktree, opens a draft PR,
5. runs two blind reviews (spec, code) and verifies every finding,
6. proves mobile lines on the iOS simulator when needed,
7. and merges through `.agents/scripts/merge-pr.sh` — never `gh pr merge`.
8. The merge to `main` ships an OTA update; a native change cannot, and is
   parked as `needs-native-build` for a maintainer.
9. Bugs: `/triage <n>` reproduces and reports; a maintainer sets `bug:ready`.
10. Agents act only on `bug:triage`, `bug:ready`, `feature:ready`, `task:ready`.

The full manual is [docs/internal/DELIVERY.md](docs/internal/DELIVERY.md);
the OTA side is [docs/internal/OTA.md](docs/internal/OTA.md).

## Skills, agents, commands

- **Skills** (`.agents/skills/`, loaded with the `skill` tool): `intent`,
  `spec-session`, `deliver`, `implement`, `review`, `triage-bug`,
  `verify-mobile`.
- **Primary agents** (`.opencode/agent/`): `factory` (unattended delivery),
  `intake` (the booth front door). The default `build` agent is for people.
- **Subagents** (started with the `task` tool, fresh context, fixed report
  block): `implementer`, `spec-reviewer`, `code-reviewer`, `review-verifier`,
  `triager`, `mobile-verifier`. Subagents never start subagents.
- **Commands** (`.opencode/command/`): `/intent`, `/spec <n> [mode]`,
  `/deliver <n>`, `/triage <n>`, `/review <pr>`.
- **Scripts** (`.agents/scripts/`): `worktree.sh` (create a worktree under
  `.worktrees/` and install), `merge-pr.sh` (the merge gate),
  `review-inputs.sh` (blind review inputs), `native-check.sh` (can this ship
  over the air?), `sim-lane.sh` (the locked simulator lane), `ensure-pnpm.sh`.

Unattended runs use `opencode run --agent factory --auto "deliver #<n>"`:
`--auto` approves what `opencode.json` leaves at "ask", and every "deny" still
holds.
