# The factory console

A web page, run locally by the maintainer, that shows the factory's workers,
every pending delivery with its time per phase, and the review statistics,
and that can start a factory run, open an interactive OpenCode session, or
chat with an OpenCode agent to capture a visitor's idea or write a spec. Why
it is built this way: [ADR 0017](adr/0017-a-local-factory-console.md), and for
the chat [ADR 0018](adr/0018-console-chats-with-intake-and-spec-agents.md).

```bash
pnpm console                 # build the page, start on http://127.0.0.1:4280
pnpm console --demo          # the same page on built-in sample data, no gh, no database
pnpm --filter @apex/console dev   # server with --watch and Vite's dev server with a proxy
```

## 1. Where the data comes from

The console never asks an agent anything and never writes to the database.
Each source is optional: when one fails, the page says which one and why, and
shows what the others give.

| Source | How | What it gives |
| --- | --- | --- |
| GitHub | `gh api` (REST and GraphQL) as the logged-in user, through `execFile`, never a shell | runners, workflow runs and jobs, issues, PRs, labels, PR bodies |
| OpenCode database | `node:sqlite`, `readOnly: true`, opened once, queried on every refresh | sessions, subagent sessions, their times, cost and tokens, the agents' text replies |
| Run logs | the `*.log.stopped` files in each run-log directory | watchdog stops and their reasons |

The server refreshes everything at most once every 10 seconds, whatever the
number of open tabs (one in-flight refresh, shared). The page asks
`GET /api/snapshot` every 10 seconds and shows the age of what it has.

### 1.1 GitHub

- **Repository**: `CONSOLE_REPO` (`owner/name`), else `gh repo view --json
  nameWithOwner` in the repository root.
- **Runners**: `repos/{repo}/actions/runners`, those carrying the `factory`
  label. Needs admin access; on 403/404 the workers are built from the jobs
  alone and the Workers panel says "runner list needs admin access".
- **Factory runs**: the last 50 runs of `factory.yml`
  (`repos/{repo}/actions/workflows/factory.yml/runs?per_page=50`) and, for
  each queued or running one, its jobs (`runner_name`, `started_at`, the job
  name `#<n>`, which is the issue).
- **Issues**: open issues with any of `feature:ready`, `task:ready`,
  `bug:ready`, `bug:triage`, `feature:blocked`, `task:blocked`,
  `bug:blocked`, plus issues closed in the last 7 days that had a factory run
  — one GraphQL query: number, title, state, labels, assignees, `createdAt`,
  `closedAt`, and the PRs whose head is `feature/<n>`, `task/<n>` or
  `bug/<n>` (number, state, isDraft, merged, `mergedAt`, labels, body, url).
- **Specs**: a second GraphQL query, read in the same refresh, apart from the
  issue query and from `AGENT_LABELS` (which drive the pipeline): open issues
  labelled `request:new` or `feature:spec`, and open or closed issues labelled
  `feature:spec`, `feature:ready`, `feature:planned` or `feature:blocked`
  (first 100 of each, newest update first) — number, title, url, body, labels,
  `createdAt`, `updatedAt`. If it fails the Specs queues are empty; the rest
  of the read is unaffected.
- **From a PR body**: the line after `### Status`
  (`Implement: … Review: … Simulator: … Native: … Gate: …`, each field
  optional, unknown fields kept as they are), the `## Review` counts
  (`Spec review: <n> findings, <m> fixed. Code review: <n> findings, <m>
  fixed.`), the `Rejected:` bullets, and the `Assumption:` lines.

### 1.2 OpenCode database

- The factory runs **OpenCode v2** (`docs/BOOTSTRAP.md`; v2.0.22 on the
  temporary Mac). Path: `OPENCODE_DB`, else
  `~/.local/share/opencode/opencode.db` (v2's name for the stable channels).
- **Tables** (v2's `packages/core/src/session/sql.ts`): `session_v2` and
  `session_message`. At start the console checks with `PRAGMA table_info`
  that `session_v2` has `id`, `parent_id`, `title`, `agent`, `directory`,
  `time_created`, `time_updated`, and `session_message` has `session_id`,
  `type`, `seq`, `data`; a missing table or column makes the source
  "unavailable: <what is missing>" (an OpenCode 1.x database, which has
  `session` instead, says so). `cost`, `tokens_input`, `tokens_output`,
  `tokens_reasoning`, `time_idle` and `idle_outcome` are used when present.
  Times are epoch milliseconds.
- **A run** is a top-level session (`parent_id` null) whose title is
  `factory deliver #<n> (attempt <k>)` or `factory triage #<n> (attempt <k>)`
  — the title `factory-run.sh` gives it. A top-level session with any other
  title (or none) is an **interactive session** (OpenCode tab).
- **Its subagents** are the sessions whose `parent_id` is the run's id. A
  subagent's agent is its `agent` column, else the `@<name>` in its title.
- **A run's end and outcome**: `session_v2.idle_outcome` (`succeeded`,
  `failed`, `interrupted`) and `time_idle`; without them, the last `idle`
  row in `session_message` (`data.outcome`), as `factory-run.sh` reads it.
- **Text replies**: an agent's final text is the text parts of its last
  `assistant` row in `session_message` (`type = 'assistant'`,
  `data.content[]` items with `type = 'text'`, joined with a blank line), as
  `factory-run.sh` reads them.
- **A run is live** while its Actions job is running; without GitHub, while
  it has no idle outcome and any of its sessions was written in the last 2
  minutes.

### 1.3 Run logs

Run-log directories: `FACTORY_RUN_LOGS` (a `:`-separated list), else every
`~/actions-runner-factory-*/_work/*/*/.worktrees/factory-runs` that exists,
plus `<repo root>/.worktrees/factory-runs`. A file named
`<issue>-<attempt>-<YYYYmmdd-HHMMSS>.log.stopped` is one watchdog stop; its
content is the reason.

### 1.4 Workflows (automations)

Future automations are GitHub workflows, most on a schedule, so the console
lists **every workflow** in `.github/workflows/` of the repository root as an
automation. Nothing has to register one: a new workflow file shows up on the
next refresh.

- **From the file** (read from disk, parsed with the `yaml` package): `name`,
  the file name, the triggers under `on:` (each `schedule` cron, and the
  event names: `workflow_dispatch`, `push`, `issues`, …), the
  `workflow_dispatch` inputs (name, required, description), the jobs' `runs-on`
  (to tell `self-hosted` from GitHub-hosted), and the **description**: the
  file's leading comment block, without the `#`, up to the first blank or
  non-comment line (`factory.yml` already has one). An automation that wants a
  description gets one by starting with a comment.
- **From GitHub**: `repos/{repo}/actions/workflows` (id, state: `active`,
  `disabled_manually`, `disabled_inactivity`) and the last 20 runs of each
  (`…/workflows/{file}/runs?per_page=20`: event, status, conclusion,
  `run_started_at`, `updated_at`, `html_url`).
- **Next run** of a scheduled one: the earliest next time over its crons,
  computed from the cron in UTC, as GitHub reads it. A small cron reader in
  `src/server/derive/cron.ts` handles `*`, lists, ranges, steps, and names
  for months and weekdays; GitHub runs schedules late under load, so the
  page says "due". A disabled workflow has no next run.
- **Refreshed at most once a minute**, not every 10 seconds: it costs one
  request per workflow, and at 10 seconds the console would spend more than
  GitHub's 5,000 requests an hour. For the same reason the repository is
  resolved once, at start.

### 1.5 Memory branch

The factory's memory ([ADR 0016](adr/0016-factory-memory-run-records-and-retro.md): `lessons/<topic>/<id>.md`,
`curated/<topic>.md`, `runs/<YYYY-MM>/<run>.md`, `retros/<date>.md`) lives on
the orphan branch `factory-memory`. The console reads it with `git`, run with
`execFile` in the repository root, **read-only and with plumbing only**: no
checkout, no write, no push.

- `git fetch --quiet origin +factory-memory:refs/remotes/origin/factory-memory`,
  at most once a minute. "couldn't find remote ref" means the branch is not
  created yet (the first factory run that writes creates it): a normal state,
  shown as "The factory has not written its memory yet.", not an error. Any
  other failure with no earlier fetch makes the source `unavailable` with the
  reason; with an earlier fetch the page shows it and says it could not refresh.
- Then `git rev-parse`, `git ls-tree -r --name-only origin/factory-memory`,
  `git show origin/factory-memory:<path>` and one `git log -1 --format=%cI`
  (the last write). When the branch did not move since the last reading, the
  tree is not read again.
- A path is read only when `ls-tree` listed it and it matches
  `^(lessons|curated|runs|retros)/[A-Za-z0-9._/-]+\.md$` without `..`. A file
  is read up to 200,000 characters; at most the newest 200 run records, 50 raw
  lessons per topic, 50 retros and 20 curated files are read. `archive/` is
  never read.
- Parsed leniently (`src/server/derive/memory.ts`): a lesson's `key: value`
  header and text; a run digest's `# Run: <mode> #<issue>, attempt <n>`,
  `- Started:` and `- Ended: stopped: <reason>` lines and its first stage row's
  time (the file name backs them up); a retro's date and first heading.

## 2. What the console works out

### 2.1 Workers

One worker per `factory` runner: name, `online`/`offline`, and `idle` or
`busy` with the issue it holds (from the running job), the run's elapsed
time, and that run's current phase (2.3). Queued factory runs are listed under
the workers as "waiting for a worker", oldest first, with their wait so far.

### 2.2 A delivery's state

Exactly one word per issue, the first that applies:

| Word | When |
| --- | --- |
| `merged` | its PR is merged |
| `running` | a factory run for it is in progress |
| `queued` | a factory run for it is queued |
| `parked` | its PR carries `needs-native-build` or `needs-simulator` |
| `blocked` | the issue carries `<kind>:blocked` |
| `failed` | its latest factory run concluded `failure`, `cancelled` or `timed_out` |
| `ready` | it carries a ready label and has no run yet |
| `triage` | it carries `bug:triage` and has no run yet |
| `closed` | anything else that is closed |

Status colours (section 4): `merged` ok; `running`, `queued`, `ready`,
`triage` idle; `parked`, `blocked` warn; `failed` error.

### 2.3 Phases

Each subagent maps to a phase:

| Agent | Phase |
| --- | --- |
| `implementer` | Implement |
| `spec-reviewer`, `code-reviewer` | Review |
| `review-verifier` | Verify |
| `mobile-verifier` | Simulator |
| `ota-verifier` | OTA check |
| `triager` | Triage |
| `spec-checker` | Spec check |
| anything else | its own name |

A subagent occupies `[time_created, time_updated]`. A phase's time in a run
is the **union** of its subagents' intervals (the two reviewers run in
parallel; their overlap counts once). **Factory** is the rest of the run's
own span, `[run.time_created, run.time_updated]`, not covered by any
subagent: claiming, the gate, waiting on CI. The phases of all attempts of an
issue add up to the issue's totals; each attempt is also shown on its own.

The **current phase** of a live run is the phase of its subagent with the
newest `time_updated`, if that was in the last 2 minutes; otherwise Factory.

**Review rounds** are the run's `review-verifier` sessions, in order.

### 2.4 Findings

Each `review-verifier` session's final text ends with its report block
(`.opencode/agent/review-verifier.md`):

```
PR: #M  Round: 1 | 2  Kind: code | adr-only | no-spec
Spec review: n findings (b blocking) | skipped  Code review: n findings (b blocking) | skipped
Fix: …
Nits: …
Rejected: …
Spec needs: …
Rerun: spec | code | both | none
```

The parser reads the last such block in the text. `Fix:`, `Nits:` and
`Rejected:` hold `none`, one item on the same line, or one item per following
line (an optional `- ` before each) until the next key. It yields per round:
spec findings and blocking, code findings and blocking (or skipped),
**confirmed** (Fix items), **nits**, **rejected**, **spec needs** (not
`none`), and Rerun. A text without a block counts as "no report".

Per issue and in total:

- **Raised**: spec + code findings over all rounds.
- **Blocking raised**: spec + code blocking.
- **Confirmed**: Fix items. **Rejected** ("not valid"): Rejected items.
  **Nits** ("not worth a round"): Nits items. **Unsorted**: blocking raised
  minus confirmed minus rejected, when positive (a verifier that classified
  a blocking finding as a nit, or dropped one).
- **Spec needs**: rounds whose Spec needs is not `none`.
- **Rounds**: rounds per run.

When the database has no verifier text for a merged PR, the `## Review`
counts from the PR body fill in Raised and fixed for that issue, marked
"from PR".

### 2.5 Totals (Stats tab)

Over a chosen window (today, 7 days, all; default 7 days), counted by a run's
start time: runs started, merged, parked, blocked, failed; watchdog stops
(2.3 of `factory-run.sh`: stalls, timeouts, provider errors, garbled turns —
the reason's first words); median and longest time per phase across finished
runs; findings as in 2.4; total cost and tokens when the database has them.

### 2.6 Automations

Per workflow: triggers as words (`every day at 06:00 UTC` when the cron is a
plain daily, weekly or hourly one; else the cron itself in mono), next run,
state, last run (status word, when, duration), and over its last 20 runs: the
success rate (`success` over completed, skipping `skipped` and `cancelled`)
and the median duration. Status words for a run: `success` ok; `failure`,
`timed_out`, `startup_failure` error; `cancelled`, `skipped` idle;
`in_progress`, `queued`, `waiting` idle. A workflow's own status: `failing`
(error) when its last completed run failed, `disabled` (idle), else `healthy`
(ok).

### 2.7 Specs queues

`src/server/derive/specs.ts`, in the snapshot as `specs: { business,
technical }`, each row `{ issue, title, url, kind, suggested, updatedAt }`:

- **Needs business spec**: an open `request:new` issue that no feature
  (open or closed, any `feature:*` label) names with a `Request: #<n>` line;
  and an open `feature:spec` whose `## Open questions` section has content
  once HTML comments, whitespace and a lone `None` or `-` are removed.
  `kind` is `request` or `feature`; `suggested` is `business`.
- **Needs technical spec**: the other open `feature:spec` issues (`kind`
  `feature`, `suggested` `technical`). The booth template pre-fills parts of
  the Technical spec, so "done" is not detected: a feature stays here until a
  person sets `feature:ready`.
- Newest update first. Empty when GitHub is unavailable.

## 3. HTTP

All JSON. Every response shape is a zod schema in `src/shared/schema.ts`; the
server validates what it sends in its tests, the page parses what it gets.

| Route | Does |
| --- | --- |
| `GET /api/snapshot?window=today\|7d\|all` | everything the page shows: `generatedAt`, `sources` (each `ok` or `unavailable` with a reason, and `refreshedAt`), `workers`, `queue`, `deliveries` (state, kind, title, PR, Status-line fields, current phase, elapsed, per-phase totals, findings), `stats`, `interactive` sessions (latest 20), `opencode` (whether the `opencode` CLI is on `PATH`, and its version) |
| `GET /api/deliveries/:issue` | one delivery with every attempt, its subagent intervals, rounds and their parsed report blocks, the watchdog stops, the Assumption lines and the Rejected list |
| `POST /api/runs` `{ "issue": n }` | dispatches `factory.yml` with `issue=n` (`gh workflow run factory.yml --repo … -f issue=n`). Refuses (409, with the reason) an issue that is closed, carries no ready or triage label, or already has a queued or running factory run. 202 on success. |
| `POST /api/opencode` | runs `opencode pair` (`execFile`, 30 s timeout, in the repository root). In v2 that starts OpenCode's background service if it is not running (loopback by default) and prints one-time links of the form `http://127.0.0.1:<port>/auth/connect/<code>`, which sign a browser in once and expire within minutes. Answers `{ url, expiresInMinutes }` with the first link on a loopback host (any other link is ignored). 503 with OpenCode's own message when `opencode` is not on `PATH`, the service is disabled, or no link comes back. The console never sees or stores OpenCode's server password. |
| `POST /api/chat` `{ "role": "intake" }` or `{ "role": "spec", "issue": n, "mode": "business" \| "technical" }` | starts a chat: maps the role to an agent and a first command (`intake` → agent `intake`, command `/intent`; `spec` → agent `spec`, command `/spec` with `<n>` for a business spec of a `request:new`, `<n> business` for a business spec of a `feature:spec`, `<n> technical` for a technical one, session titled "Spec #n · mode"; `spec` is refused with 409 for an issue that is in neither Specs queue, and for a technical spec of a request; `issue` must be a positive integer; a role is the only thing the page names, never an agent or a command), checks the agent exists (`GET /api/agent` scoped to the repository; OpenCode accepts an unknown name silently), creates a session (the intake one is titled "Idea · console"), runs the command, answers `{ sessionId }`. 409 when OpenCode has no such agent, 400 for an unknown role. |
| `GET /api/chat/:id` | `{ messages, forms, permissionPending, running, failure }`: messages oldest first, each a run of text and tool-call parts (reasoning and the command's own prompt are left out; a tool call is `{ name, status, summary }`), the forms the agent waits on, whether OpenCode waits for a permission, whether a turn is in progress |
| `POST /api/chat/:id/message` `{ text }` | sends the text (trimmed, 1–8000 characters) as the visitor's message; 202 |
| `POST /api/chat/:id/form/:formId` `{ answer }` | answers a form the agent asked, `answer` being `{ <field key>: value }`; 202 |
| `POST /api/chat/:id/stop` | interrupts the running turn; 202 |
| `GET /api/automations` | every workflow (1.4, 2.6), scheduled ones first by next run, then the rest by name |
| `GET /api/automations/:file` | one workflow with its last 20 runs |
| `POST /api/automations/:file/dispatch` | `gh workflow run <file> --ref <default branch>`; only for a workflow that has `workflow_dispatch` and no required input, else 409 with the reason; `factory.yml` is started from the Pipeline tab only (it needs an issue). 202 on success. |
| `GET /api/memory` | the memory branch (1.5): `status` (`ok`, `empty` for no branch yet, `unavailable` with a `reason`), counts, last write, the newest raw lessons, the curated files, the run records and the retros (metadata only) |
| `GET /api/memory/file?path=…` | one file's Markdown, for a run digest or a retro; the path must be in the branch's current tree and match 1.5's pattern, else 404 |
| `GET /*` | the built page; a path with no extension serves `index.html`; a missing asset is 404 |

**Chat and OpenCode.** The chat routes drive the maintainer's OpenCode
background service only through the CLI, `opencode api <METHOD> <path>` run
with `execFile` in the repository root (`src/server/opencode-api.ts`): the
CLI supplies the service's credentials, so the console never sees, reads or
stores them and never calls the service over HTTP itself. Every output is
parsed with zod and read leniently (an unknown message or content type is
passed over); an HTTP error is read from the `HTTP <code>` line and the
`_tag` in the body, not from the exit code. Only a session this console
process created can be used (an in-memory set; any other id is a 404, so after
a restart the page starts over), and only the agents in the role map
(`src/server/chat.ts`) are ever started. OpenCode's event stream is not used:
the page polls `GET /api/chat/:id` every second while a turn runs or a form is
pending, every 5 seconds otherwise. A permission request should never happen
(ADR 0012); if one does, the page says OpenCode is waiting for one and offers
no approval.

**Guard, for every request:** the `Host` header must be
`127.0.0.1:<port>` or `localhost:<port>`, else 421. A `POST` must carry an
`Origin` of `http://127.0.0.1:<port>` or `http://localhost:<port>`, else 403.
No CORS headers are ever sent.

### Configuration

Read once in `src/server/config.ts`, parsed with zod, exit with a message on a
bad value (architecture rule 6):

| Variable | Default |
| --- | --- |
| `CONSOLE_PORT` | `4280` |
| `CONSOLE_HOST` | `127.0.0.1`; only `127.0.0.1`, `localhost` or `::1` are accepted |
| `CONSOLE_REPO` | from `gh repo view` |
| `OPENCODE_DB` | `~/.local/share/opencode/opencode.db` |
| `FACTORY_RUN_LOGS` | see 1.3 |
| `CONSOLE_DEMO` | off; `--demo` on the command line sets it |

**Demo mode** serves a fixed, believable snapshot built in
`src/server/demo.ts` (two workers, one busy in Review round 2, one queued
run, eight deliveries across every state, a week of stats, three interactive
sessions) through the same routes and the same schemas. `POST /api/runs` and
`POST /api/opencode` answer 409 "demo mode" there. The chat routes answer a
short scripted conversation (a greeting, a question as a form, a draft;
nothing is filed) without OpenCode. The header shows a `demo`
status.

## 4. Look

The Callstack console style, as simlock's console has it (`ui/src/styles.css`
and `docs/internal/DESIGN.md` in callstackincubator/simlock), with Apex's
green where simlock has orange. Summary of what to carry over:

- **Type.** Geist for text and titles, Geist Mono for labels and anything
  people compare: ids, issue numbers, durations, counts, times. Bundled with
  `@fontsource-variable/geist` and `@fontsource-variable/geist-mono`. Labels
  are mono, 500, uppercase by CSS, tracking `0.08em`. Scale 12/14/16/20/28 px.
- **Shape.** Square corners everywhere. 1px borders, no shadows, no
  gradients. 4px spacing grid. Buttons and inputs at least 40px tall.
- **Colour.** Tokens on `:root`, dark values under
  `prefers-color-scheme: dark`; no theme switch.

  | Token | Light | Dark |
  | --- | --- | --- |
  | `--bg` | `#f8f8f7` | `#0e0e0f` |
  | `--surface` | `#f1f1ef` | `#161618` |
  | `--field` | `#e9e9e7` | `#1e1e21` |
  | `--chip` | `#e6e6e3` | `#232326` |
  | `--border` | `#dededb` | `#2b2b2f` |
  | `--border-strong` | `#85857f` | `#75757d` |
  | `--text` | `#111110` | `#f2f2f0` |
  | `--text-muted` | `#5a5a55` | `#a1a1a8` |
  | `--accent` | `#8dba00` | `#c6f432` |
  | `--accent-hover` | `#7aa300` | `#d4f75e` |
  | `--on-accent` | `#0a0a0c` | `#0a0a0c` |
  | `--accent-text` | `#4a6b00` | `#c6f432` |
  | `--selection` | `#e4f5a8` | `#3d4f00` |
  | `--status-ok` | `#15803d` | `#4ade80` |
  | `--status-warn` | `#a16207` | `#facc15` |
  | `--status-error` | `#b91c1c` | `#f87171` |
  | `--status-idle` | `#57534e` | `#a8a29e` |

  The greens are the Apex app's own (`apps/mobile/src/theme.ts`). **Green is
  for brand and interaction only**: the wordmark block, the current tab's
  underline, primary buttons, links, focus ring, chart marks. Never for
  state. A state is a word with an 8px square of its status colour.
- **Header.** "APEX FACTORY" wordmark, `--on-accent` on an `--accent` block,
  then a "By Callstack" chip. Right: each source as a status (`github ok`,
  `opencode unavailable`, or `demo`), and "updated 4 s ago" in mono.
- **Tabs** under the header: Overview, Ideas, Specs, Pipeline, Stats, Automations, Memory, OpenCode. Current tab
  `--text` with a 2px `--accent` underline and `aria-current="page"`. The
  URL carries the tab (`/`, `/ideas`, `/specs`, `/pipeline`, `/pipeline/42`, `/stats`,
  `/automations`, `/automations/:file`, `/opencode`), so a reload keeps it.
- **Page header**: title, actions on the right. No subtitle unless the page
  needs one to be read.
- **Stat cards**: label and big mono number; a muted caption only when it
  says what the label does not (a breakdown, a definition of jargon). At
  least 200px wide, wrapping; on a phone 140px, so two sit side by side.
- **Panels** hold tables, charts and lists: a header with title, actions and
  a muted description only where the content does not explain itself, a 1px
  line under it.
- **Tables**: mono uppercase muted headers, 16px row padding, numbers and
  durations mono and right-aligned. Short columns (ids, states, numbers,
  buttons) have a fixed width; the text columns share the rest. Under 768px
  rows stack, each cell with its column name beside it, and an empty cell
  has no line.
- **Charts**: Recharts, animation off, bars in `--accent`, grid in
  `--border`, axis text mono muted. Every chart has a caption, visually
  hidden for screen readers, and its numbers as text under it.
- **Phone first**: works at 360px wide without sideways scrolling; the tab
  bar scrolls inside itself.
- Durations read `42 s`, `7 m 05 s`, `1 h 12 m`. Times are the browser's
  local time, `HH:MM`, with the date when not today.

## 5. Views

### Overview (`/`)

- Stat cards: **Workers busy** (`1 / 2`), **Queued**, **Running**,
  **Merged today**, **Blocked or parked**.
- **Workers** panel: one card per worker — name, online/offline and
  idle/busy as statuses, and when busy: the issue (link to its delivery),
  its title, current phase, elapsed. Then "Waiting for a worker": queued runs
  with their wait.
- **In progress** panel: the running and queued deliveries as rows: issue,
  title, current phase, a phase strip (section "Phase strip"), elapsed.

### Ideas (`/ideas`)

- **Start an idea**: a primary button. It calls `POST /api/chat` with
  `{ role: "intake" }` and shows the **chat** for the returned session. The
  session id is kept in `sessionStorage`, so a reload resumes the
  conversation; **New idea** starts a fresh session. When the console no
  longer knows the session (it restarted), the page returns to the button.
- The booth visitor talks with a facilitator beside them to the `intake`
  agent, which interviews them and, only on the visitor's clear yes, files a
  `request:new` issue with `gh` (the `intent` skill). The console files
  nothing itself.
- **The chat** (`src/ui/chat/`, reusable: it takes a session id and nothing
  else, so another tab can open it on a session of another role): a
  virtualized list (`@tanstack/react-virtual`, rows measured) that sticks to
  the bottom while content arrives unless the reader scrolled up, then shows
  **Jump to latest**; the visitor's messages on the right, tinted with the
  accent, the agent's on the left as markdown (`react-markdown` with GFM; raw
  HTML is never rendered, images are dropped, links open in a new tab with
  `rel="noopener noreferrer"`); each tool call as one muted line ("loaded
  skill intent", `gh issue create …`); "thinking…" while a turn runs; the
  forms the agent asks inline under the last message (choices as buttons, a
  single choice answers on click; other fields as inputs); a composer where
  Enter sends and Shift+Enter breaks the line; **Stop** while a turn runs;
  errors in the `refusal` style. On a phone it fills the height below the
  tabs, with the composer at the bottom.

### Specs (`/specs`)

- Two panels, **Needs business spec** and **Needs technical spec** (2.7), each
  a table: issue (`#n`, to GitHub in a new tab), title, kind (business rows
  only, muted) and an action. The action is the suggested mode as a primary
  button (**Write business spec** / **Write technical spec**) and, for a
  feature, the other mode as a secondary one so a person can override; a bare
  request offers only the business spec. Empty: "Nothing waits for a business
  spec." / "Nothing waits for a technical spec."
- A click calls `POST /api/chat` with `{ role: "spec", issue, mode }` and the
  same page shows the **chat** with the `spec` agent (the command is already
  sent), under the header "#42 Title · technical" and a **Back to the
  queues** button. The session is kept in `sessionStorage`, as on Ideas. The
  `spec` agent writes issue bodies with `gh` (the `spec-session` skill) and
  cannot set a ready label; the developer does that on GitHub.

### Pipeline (`/pipeline`)

- A filter of state words (all on by default except `merged` and `closed`).
- **Deliveries** table: issue (mono `#42`, link to the delivery), title,
  kind, state, Status line (its fields as compact mono text), phase strip,
  total time, findings `raised / confirmed / rejected / nits`, PR (link to
  GitHub, new tab). Newest activity first.
- A row whose issue can be started (2.2 `ready`, `triage`, `failed`,
  `blocked` with a ready label restored) has a **Start run** secondary
  button. It asks "Start a factory run for #42?" in a dialog with **Start**
  (primary) and **Cancel**; then shows the answer: "Dispatched" or the
  refusal's reason.

### Delivery (`/pipeline/:issue`)

- Header: `#42 Title`, its state, links to the issue and the PR.
- Stat cards: total time, rounds, raised, confirmed, rejected, nits.
- **Timeline** panel: one horizontal bar per attempt, its subagent intervals
  laid on a time axis and labelled by phase; a legend; a table of the same
  numbers (phase, start, end, duration) under a "Phase by phase" disclosure.
- **Review** panel: per round, the report block's fields — the Fix, Nits and
  Rejected items as lists, Spec needs, Rerun.
- **Status** panel: the Status line, the Assumption lines, the watchdog stops
  with their reasons.

### Stats (`/stats`)

- A window select: Today, 7 days, All.
- Stat cards: runs, merged, parked or blocked, failed, watchdog stops,
  median run time.
- **Time per phase** chart: median per phase as horizontal bars, with the
  longest as text beside each; table under a disclosure.
- **Findings** chart: one stacked column per issue (confirmed, rejected,
  nits, unsorted), plus the totals as cards: raised, blocking, confirmed,
  rejected ("not valid"), nits ("not worth a round"), spec needs. Stacks are
  told apart by pattern and order as well as tone; the legend and the table
  name each.
- **Watchdog** table: when, issue, attempt, reason.
- Cost and tokens, when the database has them.

### Automations (`/automations`)

- Stat cards: **Workflows**, **Scheduled**, **Failing**, **Next run** (the
  soonest, as "in 12 m").
- **Scheduled** panel: a table — name (link to its page), schedule in words,
  next run, status, last run, success rate, median duration, and **Run now**
  (secondary, same confirm dialog as Start run) where 3 allows it.
- **On events** panel: the same table for the rest, with its triggers as
  words instead of the schedule.
- An empty Scheduled panel says "No scheduled automations yet. A workflow
  with `on: schedule` appears here."

### Automation (`/automations/:file`)

- Header: name, file name in mono, status, link to the workflow on GitHub.
- The description, as text.
- Facts as label and value pairs: triggers, schedule and next run, inputs,
  runs on, state.
- **Recent runs** table: status, event, started, duration, link to the run.
- A **Runs** chart: duration per run as columns, oldest left, failed runs
  told apart by a pattern as well as the status word in the table.

### Memory (`/memory`, `/memory/<path>`)

- Stat cards: **Lessons** (raw, not yet curated), **Curated topics**, **Run
  records**, **Retros**, **Last written**. With no branch yet the page says
  "The factory has not written its memory yet."
- **Lessons** panel: by topic, the curated summary first, then the newest raw
  lessons (five shown, the rest folded), each a short line with its date.
- **Retros** panel: newest first; each opens its report as Markdown.
- **Run records** panel: a table of when, issue (links to `/pipeline/<n>`),
  mode, attempt, outcome (finished, or stopped with the watchdog's reason) and
  duration; the time opens the digest as Markdown (`/memory/<path>`).
- Markdown is rendered by the chat's `ChatMarkdown`: raw HTML is never rendered.

### OpenCode (`/opencode`)

- **Open OpenCode**: a primary button. It calls `POST /api/opencode`, then
  opens the returned one-time link in a new tab (opened synchronously from
  the click with `window.open('', '_blank')` first, then given the URL, so a
  popup blocker lets it through). Each click pairs anew. A line under it:
  "Signs you in with a one-time link. OpenCode runs on this machine, as you,
  with your logins." On a 503 the panel shows OpenCode's message.
- **Recent sessions**: the latest 20 interactive sessions: title, agent,
  directory (cut with an ellipsis, full value in `title`), last activity,
  cost.

### Phase strip

A 100%-wide row of segments, one per phase in order of first start, width by
share of the delivery's total time, each with its phase's name in its
`title` and in a visually hidden list; the current phase is outlined in
`--text`. Phase segments use `--accent` at stepped opacities with a 1px
`--bg` gap; Factory is `--border-strong`.

## 6. Code layout

```
apps/console/
  package.json            @apex/console; scripts: start, dev, build, typecheck, test
  README.md               how to run it (for the maintainer)
  index.html, vite.config.ts, tsconfig.json (server), tsconfig.ui.json (page)
  src/shared/schema.ts    zod schemas for every response; types inferred from them
  src/server/config.ts    the only reader of process.env
  src/server/app.ts       createApp(deps) → Hono app; no I/O at import
  src/server/main.ts      config, real deps, serve, SIGINT/SIGTERM
  src/server/github.ts    gh wrapper (injectable runner) and the GitHub reads
  src/server/opencode-db.ts  schema detection and the queries
  src/server/opencode-api.ts the OpenCode service through `opencode api` (injectable exec)
  src/server/derive/specs.ts  the Specs queues (2.7)
  src/server/memory.ts    the memory branch through read-only git plumbing (injectable runner); memory-demo.ts is a fake git over a demo tree
  src/server/chat.ts      chat roles, the session set, messages and forms for the page
  src/server/run-logs.ts  the .stopped files
  src/server/workflows.ts the workflow files and their runs
  src/server/derive/*.ts  pure: state (2.2), phases (2.3), report parser (2.4), stats (2.5), Status line and Review section parsers
  src/server/demo.ts      the demo snapshot
  src/ui/…                React page
```

`pnpm console` at the root runs `pnpm --filter @apex/console start`, which
builds the page and then starts `node src/server/main.ts`.

## 7. Tests

Vitest, in `apps/console`. Each claim at its cheapest level (testing rule 6):

- **Parsers**: the report block (one-line and multi-line lists, `none`,
  `skipped` reviews, a text with prose before the block, a text with two
  blocks takes the last, a text with none); the Status line; the `## Review`
  section.
- **Phases**: overlapping reviewer intervals count once; Factory is the
  uncovered rest; the current phase of a live run; attempts add up.
- **State**: one test per row of the table in 2.2, and the order between
  them (a merged PR on an issue that still carries a ready label is
  `merged`).
- **Database**: a temporary database created in the test with v2's
  `session_v2` and `session_message` tables (their DDL copied from OpenCode
  v2.0.22), yielding a run, its subagents, its outcome and the verifier's
  text; a database with only a 1.x `session` table, and one whose
  `session_v2` lacks `parent_id`, are each "unavailable" with that reason.
- **Automations**: a workflow file's triggers, inputs and leading comment
  are read (fixtures, including one with `on: [push]` and one with
  `on: { schedule: [...] }`); the cron reader's next run for `*/15 * * * *`,
  `0 6 * * 1-5` across a weekend, `30 2 1 * *`, and names (`MON`, `JAN`);
  the dispatch route refuses a workflow with a required input and dispatches
  one without, with the exact `gh` arguments.
- **Chat**: the `opencode api` client with a stubbed exec (a message list with
  an unknown content type, an `HTTP 404` trailer as an error, the
  `location[directory]` query); the chat routes refuse an unknown role and a
  session the console did not create, map `intake` to its agent and
  `/intent`, and refuse empty or over-long text; the page's chat renders
  markdown without raw HTML and sends a pending form's choice as the reply.
- **Specs**: the queue classification (a request a feature names leaves the
  queue; `Open questions` holding only a comment or `None` is empty), the
  `spec` role (`/spec 42 technical`, a stranger issue and a non-integer
  refused), and the page rendering both queues with the suggested button first.
- **Pairing**: `opencode pair` output (stubbed) yields its loopback link;
  output with no link, and a missing binary, are 503s.
- **Routes** with `app.request()`: the snapshot validates against its
  schema; the Host guard (421) and the Origin guard (403); `POST /api/runs`
  refuses a closed issue, an issue with a running run, and dispatches with
  the exact `gh` arguments otherwise (stubbed runner); a GitHub failure
  still yields a snapshot with `github` unavailable and the OpenCode half
  filled.
- **Page**: render tests (Testing Library, jsdom) of the Overview against the
  demo snapshot: the busy worker's issue and phase are on screen; a state
  shows its word.
