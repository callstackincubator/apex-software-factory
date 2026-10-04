---
name: verify-mobile
description: Prove a PR's mobile Done when lines on the iOS simulator — a Release build of the PR's app, then its Maestro flows or a screenshot check — through .agents/scripts/sim-lane.sh, one lane per machine, detached and logged, and hand back pass, fail, busy or unavailable. Loaded by the mobile-verifier subagent. Use when the deliver orchestrator delegates simulator verification, or when someone says "verify #N on the simulator".
---

# Verify on the iOS simulator

Rule 16 in `docs/internal/agent-rules/delivery.md` and rule 2 in
`docs/internal/agent-rules/safety.md` govern this skill. You build, run,
look, and report. You do not fix anything, and you do not edit the app.

Arguments: the PR number, its branch, the Done when lines to check, and the
`flow:` test files if the orchestrator knows them.

A Release build is the only honest proof: hot-updater does not run in Expo Go
or in a dev build, and a Release build embeds the branch's JS bundle exactly
as an OTA update would deliver it.

## 1. Can this machine run it?

```bash
.agents/scripts/sim-lane.sh status
xcrun simctl list devices booted
command -v maestro
```

`sim-lane.sh` exits 69 with the reason when the machine cannot run a step
(not macOS, no Xcode tools, no Maestro for a flow). Report `unavailable` with
that reason and stop. Never install anything to make it possible — no
Maestro, no simulator runtime, no Xcode component.

No Maestro but Xcode works: lines that a screenshot can prove still run
(step 4); lines that need a tap sequence are `not covered`.

## 2. The PR's worktree

```bash
.agents/scripts/worktree.sh <branch>    # or reuse it: git worktree list
```

Run every lane step with that worktree as the working directory, so the lane
builds the PR's code and not someone else's.

## 3. Build

```bash
.agents/scripts/sim-lane.sh build      # prints the log path at once
```

Exit 75 means another worktree holds the lane; the message names the holder.
Wait in steps of at most nine minutes, for 30 minutes in all, then try once
more; still busy, report `busy` with the holder.

The build runs detached, so no tool time limit can kill it. Poll until
`<log>.exit` exists, one short call at a time (a build takes 5 to 20
minutes):

```bash
sleep 90; cat "<log>.exit" 2>/dev/null || echo running
```

A non-zero exit is `fail`: read the last error lines of the log, not the
whole log. The first build of a worktree takes longest (prebuild and
CocoaPods); later ones are incremental.

## 4. Check the lines

- **Flows.** `.agents/scripts/sim-lane.sh flow <flow files>`, then wait for
  `<log>.exit` the same way. Each flow's pass or fail is in the log summary.
- **Screens.** For a line that says what a screen shows, take a screenshot
  once the app has launched and look at it:

  ```bash
  .agents/scripts/sim-lane.sh screenshot pr<PR>-<n>   # saved under .worktrees/sim-shots/ of the main checkout
  ```

  Wait for `<log>.exit`, read the image, and say whether it shows what the
  line claims, quoting the visible text. A blank, error or red screen is
  `fail`. Screenshots stay local and are never committed; describe them, do
  not attach them.

Every line ends as `pass`, `fail`, or `not covered` (no flow and nothing a
screenshot can show).

## Report

End with exactly this block, nothing after it:

```
PR: #M  Simulator: pass | fail | busy (<holder>) | unavailable (<reason>)
Ran: build <minutes> min, flows <files or "none">, screenshots <n>; logs <paths>
Lines: <each Done when line, then pass | fail | not covered>
Evidence: <failing flow step or what the screenshot shows instead, one per line, or "none">
```
