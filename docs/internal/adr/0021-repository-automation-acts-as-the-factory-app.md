# 0021 — Repository automation acts as the factory app too

Status: Accepted

## Context

ADR 0020 moved unattended runs onto the factory's GitHub App. The
repository's own workflows still commented and labelled as
`github-actions[bot]`:

- `issue-state.yml`: label moves, promotions, closes and notes.
- `ci.yml`: the `needs-native-build` label.
- `ota-publish.yml`: the "needs a native build" comment on a merged PR.

Issues and PRs therefore showed two automated identities for one factory.

The workflow token has one property the design relied on: what it does
starts no workflow. `issue-state.yml` dispatched `factory.yml` itself after a
promotion, and removed every label it replaced itself. What the app does
starts workflows like a person's action does.

## Decision

1. **Every workflow that writes to an issue or PR mints the app's token**
   (`actions/create-github-app-token`, one step per job) and writes with it.
   The jobs' workflow-token permissions drop to what they still read.
   `labels.yml`, and `factory.yml`'s lookups and job summary, write nothing a
   person sees under a name, so they keep the workflow token.
2. **A promotion starts the factory by its label.** `issue-state.yml` no
   longer calls `createWorkflowDispatch`. Its `task:ready` and `bug:triage`
   labels start `factory.yml` the way a person's label does. `factory.yml`
   mints its token first and accepts the app's bot as a sender, alongside
   people with write access. `github-actions[bot]` is still accepted, for a
   run that is already queued.
3. **The automation sees its own changes, and must not loop.** Every label
   removal tolerates a label already gone. `completed-cleanup` now also sees
   the request that `request-close` closes, so `request-close` no longer
   strips its labels itself. A bot's comment never counts as a reporter's
   reply on `bug:needs-info`: an issue the bot opened, such as a triager's
   side finding, would otherwise reopen itself for triage.
4. **`ci.yml` takes back a `needs-native-build` label the app put on.** CI
   and the agents now share that identity, and both derive the label from
   `native-check.sh`. A label a person added still stays.

## Consequences

- Issues and PRs show one automated identity, the app's bot. The app can
  also open issues, for example a triager's side findings.
- A label set by an agent (as the bot) that agents act on starts a run, as
  it did when agents used the maintainer's login. Agents still never label
  their way into work (delivery rule 1).
- A fork's PR gets no secrets, so the label sync is skipped for it, as
  before.
- Each job that writes mints a token: a few seconds more per job, within the
  app's rate limit.
