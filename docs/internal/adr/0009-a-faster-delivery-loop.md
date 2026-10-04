# 0009 — A faster delivery loop: lean review proving, a severity gate, parallel checks, a quicker OTA path

Status: Accepted

## Context

The first clean end-to-end delivery (issue #5) took about 29 minutes: implement
3, code review 21.5, verifier 1.5, merge 0.5, OTA publish 2.5, device landing
under 0.5. The code reviewer broke code by hand and ran the full `pnpm check`
after every edit, many times, although CI runs exactly that suite on every
push. Reviews that never converged hit the two-round cap on findings nobody
would block a human PR for. The simulator check waited for the review to
finish. The OTA publish waited for a second CI run on a squash commit whose
code CI had already tested, then deployed the two platforms one after the
other.

## Decision

1. **Lean proving.** A reviewer proves a claim with the affected test file only
   (`pnpm --filter <pkg> exec vitest run <file>`, `exec jest <file>` for the
   app) and makes at most three break-and-rerun probes per review, on its
   riskiest claims. Nobody in review runs the full `pnpm check`; CI does. A
   reviewer stays in the diff and the repository (about 25 tool calls, never
   library or native sources in `node_modules`): in the second timed run a
   code review spent 18 minutes reading React Native internals.
2. **Severity gate.** A finding is _blocking_ (it breaks behaviour, leaks data,
   or breaches a rule or the spec) or a _nit_. Only confirmed blocking findings
   start another round. Nits are not reproduced; they are posted once, as one
   follow-up comment on the PR, or as a `bug:new` issue when one is a separate
   piece of work. The report block gains a `Nits:` line.
3. **Parallel simulator check.** The `mobile-verifier` starts in the same
   message as the two reviewers and checks the same commit. A failure joins
   the review's Fix lines in one implementer fix run.
4. **OTA fast path.**
   - The publish skips waiting for CI on the merge commit when its tree is
     byte-for-byte the tree of the merged PR's head commit and that head's
     `check` passed (a squash merge of a branch that was up to date with
     `main`). The proof is mechanical (`scripts/ci/wait-for-check.sh`, GitHub's
     tree ids); anything short of it waits as before.
   - iOS and Android deploy concurrently, each into its own bundle and archive
     directory.
   - After a deploy, the runner calls appduct's `ota_check_now` on every booth
     phone paired with the laptop's appduct daemon. Best effort: no daemon or
     no phone is a log line, never a failure.

5. **The implementer does not probe.** Its proof is red-first; break-and-rerun
   probes belong to the code reviewer. Its simulator self-check is one quick
   look (build, open, screenshot, release) when a screen changes, skipped for
   small changes, never a debugging session; the `mobile-verifier` runs the
   full check. Added after the first timed run, where the implementer's
   self-check turned into a 30-minute device session. `apps/mobile/TESTING.md`
   gives the app's test recipes, so nobody learns the Jest setup from
   `node_modules`.

## Consequences

- A test the reviewer did not probe can still be wired to nothing; the
  implementer's red-first tests (testing rule 2)
  remain the first line, and three probes go where a defect would hurt most.
- Fewer rounds, but nits accumulate as follow-up comments and issues the
  maintainer triages.
- A simulator failure can cost a review round that turned out moot; the
  saving on the common path (both pass) is the whole simulator wait.
- A merge that was not up to date still waits for CI. A squash merge of an
  up-to-date branch ships about a CI run sooner.
- Booth phones need a paired appduct session for the nudge; without one they
  pick the update up on their 30-second poll.
- Delivery rule 14, testing rules 2 and 3, the `review`, `deliver`,
  `verify-mobile` and `verify-ota` skills, the `code-reviewer`,
  `spec-reviewer` and `review-verifier` agents, `ota-publish.yml`,
  `scripts/ci/ota-deploy.sh`, `scripts/ci/ota-nudge.sh` and
  `apps/mobile/hot-updater.config.ts` follow from this record.
