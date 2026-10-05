# Agent rules: delivery

Rules for how work enters and leaves this repo. GitHub Issues is both the
specification and the queue (ADR 0005): an issue's body is the spec an agent
builds against, and its label is the only signal that tells an agent whether
it may act. These rules are binding in the same way the other files here are
— an agent that picks up an issue it was not entitled to, or that implements
from a comment thread instead of the body, has made an error even if the code
is good.

## Who does what

- **Product people** — booth visitors, helped by a facilitator — describe
  intent. It arrives as a `request:new` issue in their own words, from the
  feature form or the `intent` skill.
- **The product owner** (the facilitator or maintainer) turns a request into
  the business sections of a `feature:spec` issue, with the `spec-session`
  skill.
- **A developer** writes the Technical spec — what an agent needs to deliver
  the feature unattended — and sets `feature:ready`. That label is the
  developer's signature on the spec.
- **Agents** implement, test, review and merge. A merge to `main` ships an OTA
  update, unless the change is native (rule 17).

## Kinds and labels

Every open issue carries exactly one label of the form `<kind>:<state>`. The
prefix is the kind; there is no separate kind label. An open issue with zero
or two such labels is in an invalid state and must be corrected before
anything else happens to it. An issue closed as completed carries none: the
automation removes its state label and its assignee when it closes.

| Label             | Set by                             | Meaning                                                         |
| ----------------- | ---------------------------------- | --------------------------------------------------------------- |
| `request:new`     | feature form, or the `intent` skill | Inbox. Never picked up, body never edited.                      |
| `bug:new`         | bug report form                    | Reported. Nobody has looked yet.                                |
| `bug:triage`      | maintainer                         | An agent may reproduce it and write the triage report.          |
| `bug:needs-info`  | triage agent                       | Could not reproduce. Waiting on the reporter.                   |
| `bug:ready`       | maintainer, after the triage report | An agent may fix it.                                            |
| `bug:blocked`     | agent, on a blocked handoff        | Waiting on the maintainer to clear a blocker.                   |
| `feature:spec`    | spec session, on creation          | Business or technical spec in progress.                         |
| `feature:ready`   | developer                          | Business sections accepted, Technical spec written; agents go.  |
| `feature:planned` | delivering agent, on split         | Split into tasks. Never picked up itself.                       |
| `feature:blocked` | agent, on a blocked handoff        | Waiting on the maintainer to clear a blocker.                   |
| `task:draft`      | spec session, on creation          | Scope written; technical spec, approval, or deps missing.       |
| `task:ready`      | automation, or maintainer          | An agent may implement it.                                      |
| `task:blocked`    | agent, on a blocked handoff        | Waiting on the maintainer to clear a blocker.                   |

Three labels sit outside that scheme. `flaky-test` marks a bug that names a
test failing without a code change (testing rule 5). `needs-simulator` marks
a pull request parked because a Done when line needs a simulator run that has
not happened (rule 16). `needs-native-build` marks a pull request that
changes native code and so cannot ship over the air (rule 17).

Transitions per kind:

- **request**: `new` until closed. Closed as not planned, or as completed when
  the feature it became closes.
- **bug**: `new` → `triage` → `ready`, with `needs-info` as a side-trip that
  returns to `triage` when the reporter answers.
- **feature**: `spec` → `ready`, and `ready` → `planned` when the delivering
  agent splits it into the tasks its Technical spec lists. Both end at closed.
- **task**: `draft` → `ready`, and back to `draft` if the approval, the
  technical spec, or a closed dependency goes away.
- **any kind**: `triage` or `ready` → `blocked` when an agent stops on a
  blocker it names in its handoff. The maintainer clears it by re-adding the
  label it came from.

Everything after `ready` is read from GitHub itself, not from a label: in
progress means its branch exists on origin (rule 2), in review means a linked
pull request is open, done means closed as completed.

## Rules

1. **An agent acts only on `bug:triage`, `bug:ready`, `feature:ready`, and
   `task:ready`.** Nothing else is work. A `request:new` or `bug:new` issue
   is a claim from outside that nobody has looked at yet; a `feature:spec` or
   `task:draft` issue is a spec that is not finished. Agents do not label
   their way into work: only a person, or the automation a maintainer
   configured, moves an issue to a state an agent may act on. One delegation
   follows from `feature:ready`: when the developer's Technical spec lists
   tasks, the delivering agent may write each task's body from it, split the
   feature, tick each task's approval box, and deliver the tasks as they turn
   ready. A new decision that needs an ADR, or a comment that would change the
   spec, is not covered: the agent stops and hands off.

2. **The branch is the claim, and a handoff is how a claim is released.**
   Before doing anything on an issue an agent claims it with
   `.agents/scripts/claim.sh`, which creates the issue's branch on origin:
   `<kind>/<n>`, or `bug/<n>-repro` for a triage. GitHub refuses to create a
   branch that exists, so this is the one cross-agent lock in the model. An
   agent never touches an issue whose branch exists, unless the dispatcher
   started it for that issue (the branch is then an earlier run's work) or a
   person asked it to continue. An agent that stops before the PR is merged
   releases the claim (the script deletes the branch only when nothing was
   pushed to it; a branch with work stays, for the next run to continue) and
   leaves exactly one comment headed `## Handoff` with four
   sections: _Done_ (what is on the branch and how it was verified), _Not
   done_ (what remains, in the spec's own terms), _Findings_ (what was learned
   that is not in the spec and the next agent would otherwise rediscover),
   _Blocked on_ (who or what, or "nothing"). A handoff is state, never spec:
   if the work revealed that the body is wrong or incomplete, the handoff says
   "spec needs: ..." and the agent stops. One handoff per stop, no progress
   log. If Blocked on is anything but "nothing", the agent also moves the
   issue to `<kind>:blocked`.

3. **The body is the spec. Comments are discussion. Assumptions are
   proposals.** Whoever implements an issue reads its body, the documents it
   links, the house defaults (`defaults.md`), the latest `## Handoff` comment
   if there is one, and for a bug the triage report — never the rest of the
   comment thread. A comment changes nothing until a spec session folds it
   into the body. The body is cumulative: sections are added and amended in
   place, and GitHub's edit history is the record of what changed. A small
   gap that the body, these rules and the defaults all leave open is closed
   by the implementer the conservative way and recorded as an `Assumption:`
   line in the PR body: a visible proposal the reviewers check and a person
   may reject, never a change to the spec. Delivery stops for a person only
   when building would contradict the body, a rule or an accepted ADR, or
   would decide something a user notices that only a person should decide
   (ADR 0011).

4. **Every spec session starts by reconciling.** Before writing anything, the
   session fetches every comment created after the body's `lastEditedAt`, on
   the issue itself and on its linked request, and lists what those comments
   change about the spec. The person running the session accepts or rejects
   each item. Only then does the session write. It ends by editing the body
   and leaving one short comment saying which sections moved.

5. **A reporter's issue is never rewritten.** Bug reports and feature requests
   arrive through the issue forms or the `intent` skill and stay in the
   reporter's words. Triage is a comment on the bug. A feature that came from
   a request is a new issue, linked from and to the request; the request
   stays open, and closes with the feature.

6. **A feature spec describes outcomes, not implementation.** The business
   sections of `docs/internal/templates/feature.md` say what a user can do
   afterwards that they could not before, and how anyone would check it. They
   belong to the product owner. An implementation detail belongs there only
   when it _is_ a requirement — "works offline" is an outcome; "use MMKV" is
   not. Implementation lives in the Technical spec, an ADR, or a task.

7. **The Technical spec is the developer's, and it is what makes delivery
   unattended.** It names the packages and modules touched, every contract
   change in `packages/contract`, the routes and screens, whether the change
   is native (rule 17), the rules in this directory that are in play, and the
   tests to write phrased as claims. A feature or task with an empty Technical
   spec is not ready no matter what anyone says in a comment. It writes only
   what `defaults.md` does not already answer, and the session ends with a
   fresh `spec-checker` subagent whose findings (contradictions, untestable
   lines, missing failure modes, native capabilities the binary lacks) the
   developer resolves before setting the ready label (ADR 0011).

8. **Triage produces a report, not a fix.** An agent working `bug:triage`
   reproduces the bug as a failing test whose title states the claim the test
   proves, finds the root cause, and posts one comment with exactly these
   sections: _Reproduction_, _Root cause_ (with file and line), _Simplest
   fix_, _Alternatives rejected_ (at most three, one line each), _Risk_ (at
   most three bullets), and _Side findings_ when there are any. The root cause
   says first whether this is a defect (the app does the wrong thing) or a gap
   (nothing is wrong and something is missing); for a gap the test's
   expectation is a proposal, and `bug:ready` accepts it. A separate problem
   found on the way is its own `bug:new` issue. The failing test goes to a
   `bug/<number>-repro` branch with no pull request. If the agent cannot
   reproduce, it moves the issue to `bug:needs-info` and says exactly what is
   missing. Either way it releases the claim; a branch carrying the failing
   test stays.

9. **Done is defined per kind.** A task or bug is done when the pull request
   that closes it is merged; for a bug the failing test from triage is the
   regression test and must be in that PR. A `feature:ready` issue delivered
   as one PR is done when that PR is merged and its body walks every
   completion condition. A `feature:planned` issue is done when every
   sub-issue is closed; the PR that closes the last one also walks the
   parent's completion conditions. The delivering agent merges its own PR,
   but only through the gate in rule 15. The maintainer closes the feature.

10. **ADR status follows the feature.** A decision made in a spec session that
    constrains more than one change, or would be expensive to reverse,
    becomes an ADR. It is _Accepted — not yet implemented_ from the moment the
    feature leaves `feature:spec`, and _Accepted_ when the feature closes. A
    feature does not leave `feature:spec` while any ADR it links is still
    _Proposed_.

11. **The branch is named from the issue, and only from the issue.** Work on
    issue `<n>` of kind `<kind>` happens on `<kind>/<n>` — `task/18`, `bug/7`,
    `feature/3` — and a bug's reproduction lives on `bug/<n>-repro`. No slug,
    no author prefix, no date. A PR from such a branch closes that issue and
    no other.

12. **Everything an agent writes on an issue or a PR is short and plain.**
    Lead with the conclusion. Short sentences, common words, no narration of
    what the agent did or considered. Evidence goes in a code block or a link.
    Budgets, counted outside code blocks: a triage report 300 words, a handoff
    150, a PR body 200 plus its checklist, Status and Review sections, a "Spec
    updated" comment one line, a simulator evidence comment one line per
    checked line plus its media. Do not restate the issue body. Every comment,
    issue body and PR body an agent writes ends with the line
    `_Written by an agent._`, those exact characters — an agent in a person's
    session posts under that person's account (unattended runs post as the
    factory app's bot), and people and automation use the line to tell the
    two apart.

13. **Assume every agent is in a worktree.** Several agents share one clone
    through `git worktree`, under `.worktrees/`, made by
    `.agents/scripts/worktree.sh`. A branch may already be checked out
    elsewhere, so treat `origin/<branch>` as the truth; to continue a branch
    another checkout holds, branch from `origin/<branch>` rather than
    switching to it.

14. **A PR is marked ready only after two blind reviews, and every finding is
    answered.** The PR opens as a draft as soon as the spec's tests are
    committed red, so CI runs from the first push. It leaves draft only after
    two reviews of the diff against `main`, each by a fresh subagent that has
    never seen the implementer's session. Every stage runs on the same model
    (ADR 0004), so the reviews are independent only through what each one is
    allowed to see. `.agents/scripts/review-inputs.sh` prepares those inputs,
    and nothing else may be handed to a reviewer.
    The _spec review_ gets the issue body, its parent feature, the ADRs under
    Decisions, the files under Rules in play, `defaults.md`, the PR body's
    `Assumption:` lines, a bug's triage report, and the diff — never the
    other rules, the rest of the PR body, commit messages or comments. It
    answers: is every line of Scope and Done when delivered, does the diff do
    anything the spec did not ask for, does every test title state a claim
    the spec made, and is every assumption conservative and consistent with
    the spec. It reads; it runs nothing.
    The _code review_ gets every file in this directory, the ADR index, the
    diff, and a detached worktree of the PR head — never the issue, the PR
    body or the commit messages. It answers, in this order: for each changed
    function, what input, state, or interleaving makes it wrong; and does the
    diff break a rule in this directory. It proves claims with the affected
    test file only, never the full `pnpm check` (CI runs that), and makes at
    most three break-and-rerun probes, on its riskiest claims (testing rules 2
    and 3), restoring the tree afterwards. The simulator check of the same
    commit runs in parallel with both reviews.
    Each finding is one defect: a claim, the evidence as `file:line` or a
    command and its output, and a severity. _Blocking_: it breaks behaviour,
    leaks data, or breaches a rule or the spec. _Nit_: anything else. A
    blocking finding is a claim, not a fact: it is verified against the code
    before anyone acts on it. A confirmed blocking finding is fixed and the
    review that raised it runs again; a rejected one is listed in the PR body
    under `## Review` with the reason. Nits never start another round: they
    are posted once, as one follow-up comment on the PR, or as a `bug:new`
    issue when one is a separate piece of work (ADR 0009).
    Two rounds at most: a blocking finding still confirmed after the second
    round means the agent hands off and leaves the PR in draft. Rounds are
    counted per delivery run: when the maintainer restores a parked issue to
    its ready label, the next run starts again at round 1. A diff that
    only changes ADRs gets the spec review alone. A PR from a person gets the
    same two reviews when the maintainer asks for them.

15. **An agent merges only through the gate.** `.agents/scripts/merge-pr.sh`
    is the one place a delivery PR is merged from; agents never run
    `gh pr merge`. The script merges only a ready PR with no `needs-simulator`
    or `needs-native-build` label, a `## Review` section and no "spec needs"
    line, no native change, green CI, and no conflict. Before calling it the
    agent also checks what the script cannot read: no blocking finding is
    open. Anything short of that parks the issue with a handoff and leaves the
    PR for the maintainer.

16. **Devices are leased, one lane per lease, through the script.** Every
    simulator or emulator an agent uses is leased from simlock and driven
    with agent-device, and only through `.agents/scripts/device-lane.sh`
    (ADR 0007). No agent runs `simctl`, `adb`, `emulator`, `simlock` or
    `agent-device` against a device itself. A lane is one worktree, one lease
    and one agent-device session; simlock queues a lease it cannot serve
    yet, so lanes run in parallel safely. A native build holds no lease, runs
    detached, logs to a file, and waits for one of the machine's build slots.
    The `mobile-verifier`, `ota-verifier` and `triager` lease a device; the
    `implementer` never does (ADR 0015): the `mobile-verifier`'s Release run,
    in parallel with the code review, is the check. Whoever leases a device
    releases it on every path, finished or not; the lease's TTL is only the
    backstop for a crash. With a person present the agent asks before
    starting a build. When simlock finds no device within 30 minutes, or the
    machine cannot run the step, the PR gets `needs-simulator` and waits for
    the maintainer.

17. **A native change never ships unattended.** OTA updates use the
    fingerprint strategy (ADR 0003): a JS bundle reaches only binaries with
    the same native fingerprint. A change that adds, removes or re-versions an
    app dependency, edits `app.json`/`app.config.*` or a config plugin, or
    touches native sources cannot reach the booth phone over the air.
    `.agents/scripts/native-check.sh` flags it; the implementer reports it,
    the PR gets `needs-native-build`, and the gate refuses it. The maintainer
    decides whether to merge it and ship a new binary. A Technical spec that
    can avoid a native change says so; one that cannot says so up front.

## Procedures

**Claiming work.**

```bash
gh issue list --search 'label:bug:ready,feature:ready,task:ready'   # unclaimed: no <kind>/<n> on origin
.agents/scripts/claim.sh task/<n>       # or bug/<n>, feature/<n>; exit 3: already claimed
.agents/scripts/worktree.sh task/<n>    # tracks origin/<branch>
.agents/scripts/claim.sh --release task/<n>   # when stopping; keeps a branch with work
```

The PR body contains `Closes #<n>`. A bug's claim starts at `bug/<n>-repro`
when it exists, so the triage test is carried forward.

**Moving a label.** Add the new one and remove the old one in the same
command, so the one-label invariant never breaks in between:

```bash
gh issue edit <n> --add-label bug:needs-info --remove-label bug:triage
```

The repo's skills encode these procedures; use them rather than retyping the
steps. `deliver` is the orchestrator: it claims, then hands each stage to an
OpenCode subagent that starts in a fresh context and returns a fixed report —
`implementer`; `spec-reviewer`, `code-reviewer` and `review-verifier`, started
by the `review` skill; `mobile-verifier`; and after a merge `ota-verifier`.
Subagents never start subagents. `intent`, `spec-session` (which ends a technical session with the `spec-checker` subagent) and `triage-bug`
cover the rest; `agent-device`, `appduct` and `rozenite` are how any of them
works with a device.

## Automation

`.github/workflows/issue-state.yml` enforces the label rules mechanically:

- Adding a `<kind>:<state>` label removes any other one on the issue, so every
  transition is a single add.
- A `task:draft` issue becomes `task:ready` when its approval box is ticked,
  its Technical spec is filled in, and every issue under Depends on is closed.
  It is re-evaluated when its body changes and when a dependency closes.
- A `task:ready` issue with no `task/<n>` branch goes back to `task:draft`
  when that stops being true. A claimed task is left alone.
- A reporter's comment on a `bug:needs-info` issue moves it back to
  `bug:triage`, reopening it if needed. Two weeks of silence closes it.
- When the last sub-issue of a `feature:planned` issue closes, the workflow
  comments that the feature can be closed once the completion conditions hold.
- A feature closed as completed closes the request named on its `Request:`
  line, with a comment pointing at the feature.
- An issue closed as completed loses its assignee and its `<kind>:<state>`
  label.
- Nothing releases a claim automatically. When a run dies or its PR closes
  unmerged, the branch keeps the work and the next run on the issue continues
  from it; the dispatcher never waits on a claim. To start an issue over, a
  person deletes its branch.
- A pull request from a `<kind>/<n>` branch fails its check unless its body
  closes `#<n>` and nothing else.

`.github/workflows/factory.yml` is the dispatcher (ADR 0012). On the booth
laptop's self-hosted `factory` runners it starts one unattended run per
issue — `deliver` when `feature:ready`, `task:ready` or `bug:ready` is added,
`triage` when `bug:triage` is — through `.agents/scripts/factory-run.sh`, a
watchdog with a hard and a no-progress timeout. It acts only on a label set
by someone with write access or by this repository's own automation, and
never on a pull request. `issue-state.yml` acts as the factory's GitHub App
(ADR 0021), so when it promotes an issue to a state agents act on, the label
starts the run like a person's would.

The judgment calls stay manual by design: `bug:new` → `bug:triage`,
`bug:triage` → `bug:ready`, and `feature:spec` → `feature:ready`.
