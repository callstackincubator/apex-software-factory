# How work flows

GitHub Issues is the specification and the queue. An issue's body is what an
agent builds against; its label is the only thing that tells an agent whether
it may act. This page is the maintainer's manual for that model, walked
through the booth story. The binding rules are in
[agent-rules/delivery.md](agent-rules/delivery.md); this page explains how
they fit together.

## The story in one paragraph

A visitor at the reactCon Berlin booth says "I wish the app showed which talks
my friends are going to." A facilitator runs `/intent` with them; two minutes
later that sentence is a `request:new` issue in the visitor's words. The
product owner turns it into product requirements (a `feature:spec` issue). A
developer writes the technical spec that lets agents deliver it unattended,
and sets `feature:ready`. `/deliver` takes it from there: tests first, a
draft PR, two blind reviews, a simulator check, the merge gate. The merge to
`main` publishes an OTA update, and the phone at the booth picks it up — no
app store. That is the AI-native SDLC chain: intent → spec → technical plan →
PR and review → deploy record (ADR 0005).

## Who does what

| Who                                | Does                                                                                                   | Tool                        |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------- |
| Booth visitor (product person)     | Describes the idea in plain words, confirms the draft                                                  | `/intent` with a facilitator, or the issue form |
| Facilitator                        | Runs the intake conversation, approves the filing                                                       | `intake` agent              |
| Product owner                      | Writes the business sections: problem, who, outcome, completion conditions                            | `/spec <request>`           |
| Developer                          | Writes the Technical spec, accepts ADRs, sets `feature:ready`                                           | `/spec <n> technical`       |
| Maintainer                         | Triage judgments, parked PRs, native builds, closing features                                           | GitHub, `/triage`, `/review` |
| Agents                             | Implement, test, review, verify, merge                                                                  | `factory` agent, `/deliver` |
| Automation                         | Label invariants, task readiness, stale claims, request closing                                         | `issue-state.yml`           |

## Labels

| Label             | Meaning                                                         |
| ----------------- | --------------------------------------------------------------- |
| `request:new`     | Inbox. Never picked up, body never edited.                      |
| `bug:new`         | Reported. Nobody has looked yet.                                |
| `bug:triage`      | An agent may reproduce it and write the triage report.          |
| `bug:needs-info`  | Could not reproduce. Waiting on the reporter.                   |
| `bug:ready`       | An agent may fix it.                                            |
| `bug:blocked`     | Waiting on the maintainer to clear a blocker.                   |
| `feature:spec`    | Business or technical spec in progress.                         |
| `feature:ready`   | Business sections accepted, Technical spec written; agents go.  |
| `feature:planned` | Split into tasks. Never picked up itself.                       |
| `feature:blocked` | Waiting on the maintainer to clear a blocker.                   |
| `task:draft`      | Scope written; technical spec, approval or deps missing.        |
| `task:ready`      | An agent may implement it.                                      |
| `task:blocked`    | Waiting on the maintainer to clear a blocker.                   |
| `needs-simulator` | PR parked: a simulator check could not run.                     |
| `needs-native-build` | PR parked: native change, cannot ship over the air.          |
| `flaky-test`      | Names a test that fails without a code change.                  |

## Walkthrough 1: booth intent to a feature request

1. The facilitator opens OpenCode on the booth laptop and runs `/intent`. It
   switches to the `intake` agent, which can talk, read the issue form, and
   file one issue — nothing else.
2. The `intent` skill interviews the visitor in plain words: the problem, who
   has it, what they would see, how they would know it works, and an optional
   first name or handle for credit. No other personal data.
3. It shows the issue exactly as it will be filed. The visitor says yes (or
   edits); the facilitator approves the `gh issue create` prompt.
4. The issue arrives as `request:new`, with the same sections as the "Idea for
   the app" form. Nobody ever edits it; it closes when the feature ships.

## Walkthrough 2: request to product spec

1. The product owner runs `/spec <request>`. The session reads the request and
   its comments, and interviews the product owner for the business sections
   of [templates/feature.md](templates/feature.md): Problem, Who it is for,
   Outcome, Non-goals, Completion conditions, Open questions.
2. It creates a new `feature:spec` issue whose first line is
   `Request: #<request>`, and comments on the request so the visitor can
   follow along.
3. Discussion happens in comments. The next session first lists every comment
   since the body was last edited as proposed changes; the owner accepts or
   rejects each. Nobody edits the body by hand.

## Walkthrough 3: product spec to technical spec

1. A developer runs `/spec <n> technical`. The session reads the code and
   interviews the developer: packages touched (contract first), contract
   changes, whether anything is native (against
   `docs/internal/NATIVE-CAPABILITIES.md`), rules in play, the tests as
   titles, and — if it is more than one PR — the task slices. A one-PR booth
   feature starts from [templates/booth-feature.md](templates/booth-feature.md),
   pre-filled with the house defaults ([agent-rules/defaults.md](agent-rules/defaults.md)),
   so only what is specific gets written.
2. A decision that constrains more than one change becomes an ADR at
   _Proposed_; the feature waits until it is accepted.
3. The session ends with a fresh `spec-checker` subagent: contradictions
   with a rule or ADR, lines nobody could test, failure modes nothing
   answers, native capabilities the binary lacks. The developer fixes them.
4. When Open questions is empty, every ADR is accepted, the Technical spec is
   complete and the spec checker says ready, the developer adds
   `feature:ready`. That label is the developer's signature: everything after
   it is unattended, and it starts a run on the booth laptop by itself (see
   [The factory dispatcher](#the-factory-dispatcher)).

## Walkthrough 4: unattended delivery

A ready label starts `factory.yml`, which runs
`.agents/scripts/factory-run.sh <n>` (by hand: `/deliver <n>`); it starts the
`factory` agent, which loads the `deliver` skill. It never writes
code, reads a diff, or judges a finding; it starts subagents and reasons over
their report blocks.

1. **Split, if needed.** A Technical spec with Tasks is split into `task:draft`
   sub-issues by the `spec-session` skill in `split` mode. The factory ticks
   each approval box (the developer's `feature:ready` was the approval); the
   automation promotes each to `task:ready` once its dependencies close, and
   each promotion starts its own factory run.
2. **Claim.** The factory assigns itself. The branch is `<kind>/<n>`.
3. **Implement.** The `implementer` subagent makes a worktree under
   `.worktrees/`, commits the spec's tests red, opens a draft PR (so CI runs
   from the first push), turns them green contract → API → screen, runs
   `pnpm check`, and runs `native-check.sh`. A small gap the spec and the
   house defaults leave open becomes an `Assumption:` line in the PR body,
   not a stop.
4. **Review.** The `review` skill prepares blind inputs with
   `review-inputs.sh` and starts two fresh subagents in parallel. The
   `spec-reviewer` reads only the issue, its parent, linked ADRs and rules,
   and the diff — it cannot read the repository. The `code-reviewer` reads all
   agent rules and the diff, and runs and breaks code in a detached worktree —
   it cannot see the issue, the PR body, or commit messages; it proves its
   riskiest claims (three probes at most) with the affected test file, never
   the whole suite. A third fresh subagent, `review-verifier`, reproduces
   every blocking finding and confirms or rejects it. Confirmed blocking
   findings go back to the implementer; nits go into one follow-up comment
   and never start a round. At most two rounds per run (a run on an issue the
   maintainer restored to ready starts at round 1 again).
5. **Simulator, in parallel with the review.** Lines that need the app
   running go to `mobile-verifier`, started in the same message as the
   reviewers. It
   leases an iOS simulator from simlock, installs a Release build of the PR's
   worktree (appduct included, as in the booth binary; for a JS-only PR the
   cached binary with the PR's JS swapped in, ADR 0010), checks each line with
   agent-device — snapshots, waits, the PR's `e2e:` replay scripts, appduct
   shortcuts the spec's Agent hooks name — and on a failure adds Rozenite
   evidence from a debug build. Everything goes through `device-lane.sh`, and
   the device is always released. Two tasks can be at this stage at once:
   simlock queues, and a build slot keeps Xcode builds apart. No device within
   30 minutes, or a machine that cannot run it → `needs-simulator`. The
   implementer never leases a device; this run is the only simulator check. See [ADR 0007](adr/0007-device-lane-simlock-agent-device.md).
6. **Native.** A native change gets `needs-native-build` and is parked for the
   maintainer.
7. **Merge.** The factory fills the PR's `## Review` section, marks it ready,
   and runs `merge-pr.sh`, which refuses a draft, a parked label, a missing
   review result, a "spec needs" line, a native diff, red CI, or a conflict.
8. **Ship.** The merge to `main` triggers the OTA publish on the booth
   laptop's runner. The bundle carries the binary's fingerprint, so only
   compatible phones take it. See [OTA.md](OTA.md).
9. **Did it land?** `ota-verifier` waits for the publish run, installs a
   Release build of `main` from before the merge on a leased simulator, asks
   the app to check now (appduct `ota_check_now`), taps the update banner, and
   confirms the new bundle id and the feature on screen. A miss is a note for
   the maintainer, never a reason to park.
10. The run ends with one `## Delivery run` comment: merged, OTA, parked,
    waiting.

## Walkthrough 5: a bug

1. A bug arrives through the form as `bug:new`. The maintainer reads it and,
   if it sounds real, adds `bug:triage`.
2. `/triage <n>` runs the `triager` subagent: it reproduces the bug as a
   failing test on `bug/<n>-repro` (an `e2e:` replay script on a leased
   simulator when only a running app shows it, with Rozenite and appduct
   evidence), finds the root cause, and posts a report
   (Reproduction, Root cause, Simplest fix, Alternatives rejected, Risk). No
   fix, no PR. Cannot reproduce → `bug:needs-info`.
3. The maintainer agrees → `bug:ready`. `/deliver <n>` builds the fix on
   `bug/<n>` from the repro branch; the triage test is the regression test.

## Why one model changes the review

Simlock, where this setup comes from, ran reviewers on a stronger model than
the implementer. Here every stage runs on the same model, so a reviewer
cannot out-think the implementer; it can only not share its beliefs. That is
why the inputs are built by a script rather than chosen by an agent, why each
reviewer's permissions stop it reading what it must not see, why `AGENTS.md`
names the rules without restating them (it is in every agent's context), and
why verification happens in a third fresh context. If the factory ever gets a
second model, the blind inputs stay; they are cheap and they work.

## Handoffs

An agent that stops before its PR is merged — out of context, blocked, or told
to stop — unassigns itself and leaves one `## Handoff` comment: Done, Not
done, Findings, Blocked on. The branch is the other half of the handoff:
because it is always `<kind>/<n>`, the next agent knows where the commits are.
A handoff that names a blocker also moves the issue to `<kind>:blocked`. A
claim that goes silent for six hours, or whose PR is closed unmerged, is
released by the automation. Every comment an agent writes ends with
`_Written by an agent._`, because agents post under a maintainer's account.

## What is automated and what is not

`.github/workflows/issue-state.yml`: one state label per issue; `task:draft`
↔ `task:ready` from approval, spec and dependencies; a reporter's reply moves
`bug:needs-info` back to `bug:triage`; two silent weeks close it; a feature
whose last task closed gets a note; a completed feature closes its request;
an issue closed as completed loses its claim and its state label;
stale or orphaned claims are released; a `<kind>/<n>` PR must close `#<n>`.
`.github/workflows/labels.yml` keeps the labels equal to `.github/labels.json`.

Manual on purpose: `bug:new` → `bug:triage`, `bug:triage` → `bug:ready`,
`feature:spec` → `feature:ready`, merging a parked PR, and shipping a native
build.

## CI and OTA publishing

**CI** (`.github/workflows/ci.yml`) runs on every pull request and every push
to `main`, on GitHub-hosted Ubuntu only:

- `check` — `pnpm install --frozen-lockfile` and `pnpm check`. This is the
  required check: `merge-pr.sh` waits until `CI/check` has reported and passed
  on the PR head, and refuses the merge otherwise. Do not rename the job.
- `native-check` (PRs only) — runs `.agents/scripts/native-check.sh` against
  the base branch and adds `needs-native-build` when the diff is native. It
  removes the label again only if CI added it; a label a person added stays.
  It does not fail on a native change; the label parks the PR.

A newer push to a PR cancels the run in flight. Branch protection and rulesets
are not available for this private repo on the organisation's current plan,
so `merge-pr.sh` is the enforcement. If the plan changes, add a ruleset on
`main`: require a pull request and the `check` status, with repository admins
allowed to bypass.

**OTA publish** (`.github/workflows/ota-publish.yml`) runs on the booth
laptop's self-hosted runner (`runs-on: [self-hosted, ota]`) after each push to
`main` that touches `apps/mobile/**`, `packages/**` or `pnpm-lock.yaml`, and
on manual dispatch. It never runs for pull requests: the runner holds the OTA
credentials and must only run reviewed code. One publish runs at a time, and a
running one is never cancelled. Steps:

1. Put Node, the pinned pnpm and `gh` on `PATH` (`scripts/ci/runner-env.sh`).
2. Preflight (`scripts/ci/ota-preflight.sh`): every setting below is present,
   the OTA server answers `/version` and accepts the token, MinIO is up and
   the bucket exists. A failure names what to fix, usually "start the OTA
   stack" from [OTA.md](OTA.md).
3. `pnpm install --frozen-lockfile`, then print the fingerprints.
4. Wait for CI's `check` on the same commit (up to 25 minutes) — unless the
   merge commit's tree is exactly the tree of the merged PR's head commit and
   that head's `check` passed, which `scripts/ci/wait-for-check.sh` proves
   from GitHub's tree ids (a squash merge of an up-to-date branch: the same
   code, already tested). Anything else waits: a merge that was not up to
   date makes a new tree, and a maintainer may push directly.
5. Deploy iOS and Android to `production` at the same time, with the merge
   commit subject and short sha as the message (`scripts/ci/ota-deploy.sh`).
6. Nudge paired booth phones with appduct's `ota_check_now`
   (`scripts/ci/ota-nudge.sh`; best effort, see [OTA.md](OTA.md#booth-phones-appduct-pairing)).

The job summary lists each platform's result and bundle id, the channel, the
commit and the PR. If the fingerprint does not match the installed binary, the
job fails with "Needs a native build — not shipped over the air", labels the
merged PR `needs-native-build` and comments on it. Phones keep the last
bundle until a maintainer ships a new binary.

Dispatching with `preflight_only` checks the runner and the stack and prints
the fingerprints without deploying. A dispatch from any branch other than
`main` never deploys.

Configuration (repository settings → Secrets and variables → Actions). The
values must match `infra/.env` and `apps/ota-server/.env` on the booth laptop:

| Name                     | Kind     | Value                                          |
| ------------------------ | -------- | ---------------------------------------------- |
| `HOT_UPDATER_SERVER_URL` | variable | `http://127.0.0.1:3002/hot-updater`            |
| `S3_ENDPOINT`            | variable | `http://127.0.0.1:9000`                        |
| `S3_REGION`              | variable | `S3_REGION` from `apps/ota-server/.env`        |
| `S3_BUCKET`              | variable | `S3_BUCKET` from `infra/.env`                  |
| `HOT_UPDATER_AUTH_TOKEN` | secret   | `HOT_UPDATER_AUTH_TOKEN` from `apps/ota-server/.env` |
| `S3_ACCESS_KEY_ID`       | secret   | `S3_ACCESS_KEY_ID` from `infra/.env`           |
| `S3_SECRET_ACCESS_KEY`   | secret   | `S3_SECRET_ACCESS_KEY` from `infra/.env`       |
| `OTA_MISMATCH_PATTERN`   | variable | optional: regex for the fingerprint-mismatch message |

The runner is a launchd service, and its `PATH` is the snapshot in
`~/actions-runner/.path`, taken when it was installed. That snapshot can point
at directories that no longer exist (an fnm shell directory, for example), so
`runner-env.sh` does not rely on it. It looks for Node 22.18 or newer in the
fnm default alias, Volta, Homebrew and `/usr/local/bin`. It gets the pinned
pnpm through `.agents/scripts/ensure-pnpm.sh`, and finds `gh` in Homebrew. To
force a Node, set `APEX_NODE_BIN=<dir>` in `~/actions-runner/.env` and restart
the service (`cd ~/actions-runner && ./svc.sh stop && ./svc.sh start`).

## The factory dispatcher

`.github/workflows/factory.yml` turns labels into runs (ADR 0012). It runs on
the booth laptop's self-hosted runners labelled `factory` —
`booth-factory-1` and `booth-factory-2`, launchd services in
`~/actions-runner-factory-1` and `-2`, registered to this repository and
running as the maintainer's user — so two issues are delivered side by side.

| Trigger | Run |
| --- | --- |
| `feature:ready`, `task:ready` or `bug:ready` added | `factory-run.sh <n>`: the `factory` agent delivers it |
| `bug:triage` added | `factory-run.sh --triage <n>`: the `triager` agent |
| `workflow_dispatch` with `issue` | either, by the issue's current label |
| `issue-state.yml` promoting a task or a bug | a `workflow_dispatch` (labels set with the workflow token start no workflow) |

A run acts only when the label's sender has write access or is this
repository's automation, never on a pull request, and checks out `main`.
Runs for one issue queue behind each other (concurrency group per issue);
the job times out after 90 minutes, and `factory-run.sh`'s watchdog stops a
run with no progress for 15 minutes, restarts it once from the branch, and
otherwise leaves the handoff. The job summary links the issue and the PR.
Every attempt leaves a run record (ADR 0016): a digest of each stage on the
`factory-memory` branch (`.agents/scripts/memory.sh runs --issue <n>`), and
the logs, journals and transcripts in the job's artifact
`factory-run-<issue>-<run id>-<attempt>`; the next job's checkout wipes
`.worktrees/factory-runs/`. The `retro` agent reads them from any machine:
[MEMORY.md](MEMORY.md).

Runner setup (once per runner directory, as the maintainer's user):

- **simlock**: until it is on npm, the lanes need the CLI and its state
  directory. Put them in the runner's `.env` (key=value lines the runner
  hands to every job) and restart the service:

  ```sh
  cd ~/actions-runner-factory-1
  printf 'SIMLOCK_BIN=node /Users/aitwar/Projects/simlock/dist/cli/main.js\nSIMLOCK_HOME=/tmp/apex-slk\n' >> .env
  ./svc.sh stop && ./svc.sh start
  ```

  `SIMLOCK_HOME` must be the one the running simlock daemon uses
  (`/tmp/apex-slk` on the dev Mac). Without `SIMLOCK_BIN` the job warns and
  simulator checks report `unavailable`.
- **OpenCode**: `~/.opencode/bin/opencode`, with the provider definition in
  the repository's `opencode.json` (ADR 0014) and the login in
  `~/.local/share/opencode/auth.json` — the runner runs as the same user, so
  the maintainer's login applies. The run uses `--standalone`, so it inherits
  the job's environment.
- **GitHub**: the agents post, push and open PRs as the maintainer, through
  `gh`'s own login (`gh auth status` as that user); the workflow points the
  checkout's git credential helper at `gh auth git-credential`. The workflow
  token is never used for that: a push made with it would start no CI.
- **Node, pnpm, gh** come from `scripts/ci/runner-env.sh`, as for the OTA
  runner.

## Pointers

- Rules: [agent-rules/](agent-rules/) — delivery, architecture, testing,
  documentation, safety
- Templates: [templates/feature.md](templates/feature.md),
  [templates/booth-feature.md](templates/booth-feature.md),
  [templates/task.md](templates/task.md)
- Forms: `.github/ISSUE_TEMPLATE/`; PR body: `.github/pull_request_template.md`
- Skills: `.agents/skills/`; agents and commands: `.opencode/`; config:
  `opencode.json`
- Scripts: `.agents/scripts/` — `worktree.sh`, `review-inputs.sh`,
  `native-check.sh`, `device-lane.sh`, `merge-pr.sh`, `factory-run.sh`,
  `run-record.sh`, `memory.sh`, `prewarm.sh`, `check-agent-permissions.sh`,
  `ensure-pnpm.sh`; the native
  build cache in `tools/expo-build-cache/`
- Workflows: `.github/workflows/` — `ci.yml`, `ota-publish.yml`,
  `factory.yml`, `issue-state.yml`, `labels.yml`; their helpers are in
  `scripts/ci/`
- OTA: [OTA.md](OTA.md)
- Memory, run records and the retro: [MEMORY.md](MEMORY.md)
- Devices (simlock, agent-device, appduct, Rozenite host setup): [DEVICES.md](DEVICES.md),
  [ADR 0007](adr/0007-device-lane-simlock-agent-device.md)
