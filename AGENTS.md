# Agent guide

Apex Software Factory is a showcase of an AI-native delivery line. Booth
visitors at reactCon Berlin (Oct 7–9, 2026) describe an idea for an
almost-empty Expo app; it becomes product requirements, a developer writes the
technical spec, and agents implement, test, review and merge it unattended —
the merge ships an over-the-air update to the phone at the booth.

The factory runs on **OpenCode with one model**, `callstack.ai/callstack/Apex`,
set once in `opencode.json` (ADR 0004). No agent, command or skill names
another model; an agent file may name the same one to pick a reasoning
variant (ADR 0008). This file is the single entry point for every agent and
every tool.

## Layout

| Path                | What                                                                     |
| ------------------- | ------------------------------------------------------------------------ |
| `apps/mobile`       | Expo app (expo-router, hot-updater, Jest). `@apex/mobile`                |
| `apps/api`          | Product HTTP API, Hono on Node. `@apex/api`                              |
| `apps/ota-server`   | Self-hosted hot-updater server — release infrastructure, not product     |
| `apps/console`      | The factory console: local web page, host tooling. `@apex/console`       |
| `packages/contract` | Every wire shape as zod schemas, plus the typed client. `@apex/contract` |
| `docs/internal/`    | ADRs, agent rules, delivery manual, spec templates                       |
| `.agents/`          | Skills (`skills/<name>/SKILL.md`) and helper scripts (`scripts/`)        |
| `.opencode/`        | Subagents and primary agents (`agent/`), slash commands (`command/`)     |
| `tools/`            | Host tooling: the native build cache (`expo-build-cache/`, ADR 0010)     |
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
- [defaults.md](docs/internal/agent-rules/defaults.md) — the house answers
  for whatever a spec leaves unsaid.

This file only points at those rules; it does not restate them. It is loaded
into every agent's context, including the spec reviewer, which must stay
blind to the rules — keep it that way.

## The delivery flow

1. A visitor's idea becomes a `request:new` issue, in their words (`/intent`
   with a facilitator, or the issue form).
2. The product owner turns it into the business sections of a `feature:spec`
   issue (`/spec <n>`).
3. A developer writes the Technical spec (`/spec <n> technical`, ending with
   the spec checker) and sets `feature:ready` — the signature that allows
   unattended delivery. The label starts a run on the booth's `factory`
   runners (`.github/workflows/factory.yml`).
4. `/deliver <n>` claims it, splits it into tasks if the spec lists them, and
   per issue: implements tests-first in a worktree, opens a draft PR,
5. runs two blind reviews (spec, code) and, in parallel, proves mobile lines
   on a leased iOS simulator; verifies every blocking finding (nits go into
   one follow-up comment),
6. closes small spec gaps as `Assumption:` lines in the PR instead of
   stopping,
7. and merges through `.agents/scripts/merge-pr.sh` — never `gh pr merge`.
8. The merge to `main` ships an OTA update, checked on a simulator afterwards;
   a native change cannot ship, and is parked as `needs-native-build` for a
   maintainer.
9. Bugs: `/triage <n>` reproduces and reports; a maintainer sets `bug:ready`.
10. Agents act only on `bug:triage`, `bug:ready`, `feature:ready`, `task:ready`.

The full manual is [docs/internal/DELIVERY.md](docs/internal/DELIVERY.md);
the OTA side is [docs/internal/OTA.md](docs/internal/OTA.md); how runs are
recorded, remembered and reviewed is
[docs/internal/MEMORY.md](docs/internal/MEMORY.md). An overview
with diagrams is [docs/FACTORY.md](docs/FACTORY.md); setting up a machine
from zero is [docs/BOOTSTRAP.md](docs/BOOTSTRAP.md).

## Skills, agents, commands

- **Skills** (`.agents/skills/`, loaded with the `skill` tool): `intent`,
  `spec-session`, `deliver`, `implement`, `review`, `triage-bug`,
  `verify-mobile`, `verify-ota`, `retro`; and the device tools `agent-device`,
  `appduct`, `rozenite` (vendored upstream skills, each with a `SOURCE.md`).
  Also vendored: eleven Expo and React Native guides (`expo-*`,
  `swm-react-native-best-practices`, `callstack-react-native-best-practices`,
  `vercel-composition-patterns`, `react-native-mmkv`,
  `react-native-vision-camera`). They are in no agent's skill list, only the
  implementer may load them, and the `implement` skill names them (ADR 0022).
- **Primary agents** (`.opencode/agent/`): `factory` (unattended delivery),
  `intake` (the booth front door), `spec` (spec sessions with a product
  owner or a developer), `retro` (looks back at runs and proposes
  improvements). The default `build` agent is for people.
- **Subagents** (started with the `task` tool, fresh context, fixed report
  block): `implementer`, `spec-reviewer`, `code-reviewer`, `review-verifier`,
  `triager`, `mobile-verifier`, `ota-verifier`, `spec-checker`. Subagents
  never start subagents.
- **Commands** (`.opencode/command/`): `/intent`, `/spec <n> [mode]`,
  `/deliver <n>`, `/triage <n>`, `/review <pr>`, `/retro [scope]`.
- **Scripts** (`.agents/scripts/`): `claim.sh` (claim an issue by creating
  its branch on origin, or release it), `attach.sh` (upload screenshots and
  videos as GitHub attachments for a comment), `worktree.sh` (create a worktree under
  `.worktrees/` and install), `merge-pr.sh` (the merge gate),
  `review-inputs.sh` (blind review inputs), `native-check.sh` (can this ship
  over the air?), `device-lane.sh` (a simlock-leased device driven with
  agent-device, appduct and Rozenite; reuses a cached native build for a
  JS-only change), `factory-run.sh` (one unattended run with a watchdog),
  `prewarm.sh` (the booth laptop's morning warm-up), `memory.sh` (the
  factory's memory: recall and leave lessons, journal lines, run records),
  `run-record.sh` (an attempt's digest and transcript, for the retro),
  `check-agent-permissions.sh` (no agent can reach "ask"), `ensure-pnpm.sh`.
- **Devices**: simulators and emulators are leased through simlock and driven
  through agent-device, only via `.agents/scripts/device-lane.sh`. The
  `agent-device` and `appduct` MCP servers in `opencode.json` are for a
  person in the `build` agent; every other agent is denied their tools.

Permissions are allow-by-default with a short deny list (ADR 0012): no
`gh pr merge`, no force push or push to `main`, no skipped hooks, no OTA
deploy, no `.env` files, no device-pool operator commands; reviewers keep
their blind-review isolation. Nothing asks, for any agent: a subagent's ask
would wait forever. Unattended runs go through
`.agents/scripts/factory-run.sh <n>`, which runs
`opencode run --standalone --agent factory --auto "deliver #<n>"` under a
watchdog. After changing any permission in `opencode.json` or
`.opencode/agent/`, run `.agents/scripts/check-agent-permissions.sh` on a
machine with OpenCode, in a checkout not nested inside another; CI cannot
run it.
