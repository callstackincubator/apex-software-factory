---
name: deliver
description: Deliver a ready issue end to end, unattended — a task, a bug, or a whole feature:ready feature (split it into the tasks its Technical spec lists, then walk them in dependency order, two at a time). Claims, delegates implementation, review and simulator checks to fresh subagents, reasons only over their report blocks, and merges each PR through the gate so the merge ships an OTA update. Use when someone says "deliver #N", "/deliver N", "pick up the next ready issue", or "ship #N".
---

# Deliver

You are the orchestrator. You never write code, run the suite, or review a
diff yourself. You read issues, decide the next step, hand it to the subagent
for that stage, and reason over the report block it hands back. That keeps
your context about the issues, not about file contents, so one run can carry
a whole feature.

Rules 1, 2, 9, 14, 15, 16 and 17 in `docs/internal/agent-rules/delivery.md`
govern this skill.

**Delegating.** Every stage that touches code runs in an OpenCode subagent,
started with the `task` tool. It begins with a fresh context, loads its own
instructions, and returns only its report block:

| Stage     | How                                                                                        | Returns          |
| --------- | ------------------------------------------------------------------------------------------ | ---------------- |
| Implement | subagent `implementer` (skill `implement`)                                                 | implement report |
| Review    | load skill `review` here; it starts `spec-reviewer`, `code-reviewer` and `review-verifier` | review report    |
| Simulator | subagent `mobile-verifier` (skill `verify-mobile`)                                         | simulator report |
| OTA check | subagent `ota-verifier` (skill `verify-ota`), after a merge                                | OTA report       |

Review runs from your session because subagents cannot start subagents; you
only prepare the inputs, start the three, and pass report lines along. You
never read the diff or judge a finding yourself.

Pass everything a stage needs in its task prompt: the issue, the branch, the
PR once there is one, the mode, and the lines pasted from an earlier report
that it must act on. Never paste your own reasoning, the issue's comment
thread, or one stage's narration into another; pass report lines only. The
reviewers in particular get nothing but the paths the review skill names:
their blindness is the only independence a one-model factory has.

A report without its block, or with narration in place of it, is not a
result: run the same subagent again with the same prompt plus "the last run
ended without its report block; report on the work already done".

**A person present or not.** If a person is in this session, show any text
you are about to post and ask before a simulator build. Unattended, post
directly. Devices are leased from simlock by the subagents that use them
(rule 16, ADR 0007); you never touch one yourself.

## 1. Take stock

```bash
gh issue view <N> --json number,title,labels,assignees,body
```

- `task:ready`, `bug:ready`: one issue; go to step 3.
- `feature:ready` whose Technical spec has no Tasks list: one PR delivers it;
  go to step 3.
- `feature:ready` with a Tasks list: split it first (step 2), then walk its
  tasks.
- `feature:planned`: walk its open sub-issues (step 4).
- Anything else, or an assignee that is not you: stop and say why (rule 1).

## 2. Split a feature:ready feature

`feature:ready` means a developer accepted the business sections, wrote the
Technical spec and its task slices, and accepted every linked ADR. Load the
`spec-session` skill with the `skill` tool and run it on the feature in
`split` mode, unattended. It writes each task's body from the developer's
slices, checks them for contradictions and overlap, links overlapping tasks
under Depends on, and ticks each approval box. If it reports that a decision
needs an ADR, or a comment would change the spec, stop: park the feature
(step 6) with that under Blocked on.

## 3. Deliver one issue

Claim it: `gh issue edit <N> --add-assignee @me`. Its branch is `<kind>/<N>`.

1. **Implement.** `implementer` with `issue #N, branch <kind>/<N>, mode
build`. A report with `spec needs` under Open: park (step 6).
2. **Review.** Load the `review` skill and run it on PR #M. Fix lines:
   `implementer` with mode `fix` and the Fix lines pasted, then the `review`
   skill again with `round 2` and the report's Rerun value. Spec needs, or a
   confirmed blocking finding after round 2: park. Keep every Rejected line.
   Rounds are counted per run: when the maintainer restores a parked issue
   to a ready label, this run starts again at round 1 on the branch as it
   is, whatever earlier runs reached (rule 14).
3. **Simulator.** If implement reported Simulator lines,
   `mobile-verifier` with the PR, the branch, those lines (Done when lines
   and `e2e:` scripts) and the spec's Agent hooks, pasted from the issue.
   `fail`: `implementer` in fix mode with the Evidence lines, then the
   `review` skill round 2 on the code review, then `mobile-verifier` once
   more. `busy` (simlock found no device within 30 minutes) or `unavailable`
   (this machine cannot run it): add the `needs-simulator` label to the PR
   and park.
4. **Native.** If implement reported `Native: yes`, add the
   `needs-native-build` label to the PR. Do step 5, mark it ready
   (`gh pr ready <M>`), and park instead of running the gate, with Blocked
   on: "maintainer: native change, needs a new binary before it can ship".
   The gate would refuse it anyway (rule 17).
5. **Finish the PR body.** Walk every Done when line and say how each was
   checked; for the last open sub-issue of a feature, walk the parent's
   Completion conditions too (rule 9). Fill the `## Review` section:

   ```markdown
   ## Review

   Spec review: <n> findings, <m> fixed. Code review: <n> findings, <m> fixed.

   Rejected:

   - <claim> — <reason>
   ```

   Omit "Rejected:" when nothing was. Rule 12: 200 words plus the checklist,
   Status and Review sections, ending with `_Written by an agent._`.

6. **Ready and merge.** `gh pr ready <M>`, then run the gate, waiting at most
   nine minutes per call for CI (give the bash tool a ten-minute timeout):

   ```bash
   .agents/scripts/merge-pr.sh <M> 9
   ```

   Exit 0 merged it, and the merge to `main` starts the OTA publish. Exit 2
   means CI is still running: run it again, up to four times. Any other exit:
   park with the line it printed.

7. **Did it land?** After a merge that changed `apps/mobile/` or
   `packages/`, start `ota-verifier` with the PR, its merge commit
   (`gh pr view <M> --json mergeCommit -q .mergeCommit.oid`) and the text a
   user should see once the update applies: the feature's title in the
   "Shipped at the booth" list, or the text of a simulator Done when line.
   Start it in the same message as the next task's stage when there is one;
   nothing waits on it. Its OTA line goes into the run's comment (step 5);
   `not landed` or `not shipped` is a note for the maintainer, never a
   reason to reopen or park anything.

Keep the PR body's status line current after every stage, so any session can
resume from GitHub alone:

```
### Status

Implement: done (5/5 green)  Review: round 2, 0 open  Simulator: pass  Native: no  Gate: merged
```

## 4. Walk a feature's tasks

```bash
gh api graphql -F owner='{owner}' -F repo='{repo}' -F number=<N> -f query='
  query($owner:String!,$repo:String!,$number:Int!){
    repository(owner:$owner,name:$repo){ issue(number:$number){
      subIssues(first:50){nodes{number title state
        labels(first:5){nodes{name}} assignees(first:3){nodes{login}}}}}}}'
```

Runnable means open, `task:ready`, and unassigned; the issue-state workflow
makes a task ready only once everything under its Depends on is closed, so
readiness already encodes the order. Deliver up to two runnable tasks at
once: start each stage for both with two `task` calls in the same message,
and keep the two pipelines apart. Each task has its own worktree, so they
never share files. Both may be at the simulator stage at once: each
`mobile-verifier` leases its own device, simlock queues a lease it cannot
serve yet, and the lane's build slot keeps two Xcode builds from running
together. After each merge,
list again: merging closes the task, and the tasks that waited on it turn
ready on their own.

When a task parks, keep delivering the tasks that do not depend on it. Stop
when nothing is runnable and nothing is in flight.

## 5. End of the run

Post one comment on the feature (or the single issue):

```markdown
## Delivery run

Merged: #PR (#task), ...
OTA: #PR — <landed | not landed | not shipped | busy | unavailable, from the OTA report>, ...
Parked: #task — <reason, one line>, ...
Waiting: #task — on #dependency, ...

_Written by an agent._
```

## 6. Parking an issue

Leave exactly one `## Handoff` comment (Done, Not done, Findings, Blocked on;
150 words; rule 2) — the implementer has already pushed the branch — and
release the claim:

```bash
gh issue comment <N> --body-file - <<'EOF'
## Handoff
...
_Written by an agent._
EOF
gh issue edit <N> --remove-assignee @me
```

You edit no files: every body you post goes through `--body-file -` and a
heredoc, and a PR body is replaced with `gh pr edit <M> --body-file -`.

If Blocked on is anything but "nothing", move the issue to `<kind>:blocked`. A
PR parked as `needs-simulator` or `needs-native-build` stays open and ready;
the maintainer verifies it, ships a binary, or re-runs this skill on a
machine that can.

## Your own report

```
Run: #N  Merged: <PRs or none>  Parked: <issues with reasons or none>  Waiting: <issues or none>
Next: <what the maintainer should do, or "nothing">
```
