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
   changes, whether anything is native, rules in play, the tests as titles,
   and — if it is more than one PR — the task slices.
2. A decision that constrains more than one change becomes an ADR at
   _Proposed_; the feature waits until it is accepted.
3. When Open questions is empty, every ADR is accepted and the Technical spec
   is complete, the developer adds `feature:ready`. That label is the
   developer's signature: everything after it is unattended.

## Walkthrough 4: unattended delivery

`/deliver <n>` (or `opencode run --agent factory --auto "deliver #<n>"`)
starts the `factory` agent, which loads the `deliver` skill. It never writes
code, reads a diff, or judges a finding; it starts subagents and reasons over
their report blocks.

1. **Split, if needed.** A Technical spec with Tasks is split into `task:draft`
   sub-issues by the `spec-session` skill in `split` mode. The factory ticks
   each approval box (the developer's `feature:ready` was the approval); the
   automation promotes each to `task:ready` once its dependencies close.
2. **Claim.** The factory assigns itself. The branch is `<kind>/<n>`.
3. **Implement.** The `implementer` subagent makes a worktree under
   `.worktrees/`, commits the spec's tests red, opens a draft PR (so CI runs
   from the first push), turns them green contract → API → screen, runs
   `pnpm check`, and runs `native-check.sh`.
4. **Review.** The `review` skill prepares blind inputs with
   `review-inputs.sh` and starts two fresh subagents in parallel. The
   `spec-reviewer` reads only the issue, its parent, linked ADRs and rules,
   and the diff — it cannot read the repository. The `code-reviewer` reads all
   agent rules and the diff, and runs and breaks code in a detached worktree —
   it cannot see the issue, the PR body, or commit messages. A third fresh
   subagent, `review-verifier`, reproduces every finding and confirms or
   rejects it. Confirmed findings go back to the implementer; at most two
   rounds.
5. **Simulator.** Lines that need the app running go to `mobile-verifier`: a
   Release build of the PR's worktree and a Maestro flow or screenshot,
   through the locked `sim-lane.sh`. Busy or impossible → `needs-simulator`.
6. **Native.** A native change gets `needs-native-build` and is parked for the
   maintainer.
7. **Merge.** The factory fills the PR's `## Review` section, marks it ready,
   and runs `merge-pr.sh`, which refuses a draft, a parked label, a missing
   review result, a "spec needs" line, a native diff, red CI, or a conflict.
8. **Ship.** The merge to `main` triggers the OTA publish on the booth
   laptop's runner. The bundle carries the binary's fingerprint, so only
   compatible phones take it. See [OTA.md](OTA.md).
9. The run ends with one `## Delivery run` comment: merged, parked, waiting.

## Walkthrough 5: a bug

1. A bug arrives through the form as `bug:new`. The maintainer reads it and,
   if it sounds real, adds `bug:triage`.
2. `/triage <n>` runs the `triager` subagent: it reproduces the bug as a
   failing test on `bug/<n>-repro`, finds the root cause, and posts a report
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
stale or orphaned claims are released; a `<kind>/<n>` PR must close `#<n>`.
`.github/workflows/labels.yml` keeps the labels equal to `.github/labels.json`.

Manual on purpose: `bug:new` → `bug:triage`, `bug:triage` → `bug:ready`,
`feature:spec` → `feature:ready`, merging a parked PR, and shipping a native
build.

## Pointers

- Rules: [agent-rules/](agent-rules/) — delivery, architecture, testing,
  documentation, safety
- Templates: [templates/feature.md](templates/feature.md),
  [templates/task.md](templates/task.md)
- Forms: `.github/ISSUE_TEMPLATE/`; PR body: `.github/pull_request_template.md`
- Skills: `.agents/skills/`; agents and commands: `.opencode/`; config:
  `opencode.json`
- Scripts: `.agents/scripts/` — `worktree.sh`, `review-inputs.sh`,
  `native-check.sh`, `sim-lane.sh`, `merge-pr.sh`, `ensure-pnpm.sh`
- OTA: [OTA.md](OTA.md)
