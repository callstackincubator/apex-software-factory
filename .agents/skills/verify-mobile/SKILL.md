---
name: verify-mobile
description: >-
  Prove a PR's simulator Done when lines and e2e: replay scripts on a leased
  iOS simulator — a Release build of the PR's worktree installed through
  .agents/scripts/device-lane.sh, checked with agent-device (open, snapshot,
  wait, is, replay), shortcut with appduct, with Rozenite evidence on a
  failure — and hand back pass, fail, busy or unavailable. Always releases the
  device. Loaded by the mobile-verifier subagent. Use when the deliver
  orchestrator delegates simulator verification, or when someone says "verify
  #N on the simulator".
---

# Verify on a leased simulator

Rule 16 in `docs/internal/agent-rules/delivery.md`, rule 2 in
`docs/internal/agent-rules/safety.md` and ADR 0007 govern this skill. You build, run, look,
and report. You do not fix anything, and you do not edit the app.

Arguments: the PR number, its branch, the Done when lines to check, the `e2e:` scripts if the
orchestrator knows them, and the spec's Agent hooks if it has any. You run in parallel with the
two code reviews of the same commit (delivery rule 14): never wait for them, and never read
their worktree.

Load the `agent-device` skill now; load `appduct` when the Agent hooks name a tool, and
`rozenite` only for a failure (step 6).

**Why Release.** A Release build embeds the branch's JS bundle exactly as an OTA update would
deliver it, with appduct linked as in the booth binary (`APPDUCT_ENABLED=1` everywhere). A
debug build loads JS from Metro, so it proves less; it is for explaining a failure.

**Every command** in this skill runs in the PR's worktree (step 1) through
`.agents/scripts/device-lane.sh`. You never call `xcodebuild`, `expo`, `simctl`, `adb` or
`simlock` directly, and never install anything: a missing tool is `unavailable`.

## 1. The PR's worktree, and can this machine run it?

```bash
.agents/scripts/worktree.sh <branch>        # or reuse it: git worktree list
cd <worktree> && .agents/scripts/device-lane.sh status
```

Exit 69 names what is missing (no simlock CLI, no Xcode): report `unavailable` with that line
and stop. `status` also shows whether this lane already holds a lease from an earlier run; if
it does, `release` it before you start.

## 2. Build, then lease

The build holds no device, so start it first and lease while it runs:

```bash
.agents/scripts/device-lane.sh build ios release     # prints <log> at once
.agents/scripts/device-lane.sh lease ios             # give the bash tool a ten-minute timeout
```

`lease` exits:

- 0: leased. It prints the lease id, model, OS and UDID: keep them for the report.
- 2: still queued in simlock. Run the same command again, up to four times.
- 75: `busy` — simlock had no device within 30 minutes. Report `busy` with its line.
- 69: `unavailable` — this machine cannot provide that device. Report it.

From the moment `lease` returns 0 until your report, every path out of this skill — pass,
fail, an error, a step you cannot finish — goes through step 7 first.

Then wait for the build, one short call at a time. A JS-only PR reuses the cached binary for
its native fingerprint and swaps the PR's JS bundle in (ADR 0010): ready in under a minute, the
log says `build cache: hit`. A native change, or a fingerprint nobody built yet, compiles once
(minutes) and fills the cache:

```bash
sleep 20; cat "<log>.exit" 2>/dev/null || echo running
```

The build may first wait for a build slot another lane holds; the log says so. A non-zero exit
is `fail`: read the last 30 lines of the log, not the whole log, and quote the first error.

## 3. Install and open

```bash
.agents/scripts/device-lane.sh install
.agents/scripts/device-lane.sh ad open com.callstack.apexfactory --foreground
```

The initial snapshot is your first evidence. A red screen, a crash or an empty snapshot is
`fail`.

## 4. Check each line

- **`e2e:` scripts.** One at a time, in the lane's session (do not `close` first):

  ```bash
  .agents/scripts/device-lane.sh ad replay apps/mobile/e2e/<name>.ad
  ```

  Exit 0 passes. On a failure the output names the step that diverged; quote it. A script
  ending in `close` ends the session: `ad open` again before the next check.

- **Screen lines** ("on the simulator: …"). Reach the screen the line names the cheapest way
  the spec allows: a deep link (`ad open com.callstack.apexfactory "apexfactory:///<route>"`),
  an appduct tool from the Agent hooks (`appduct link`, then `appduct call open_route
'{"path":"/<route>"}'` or a seed tool), or taps from the snapshot. Then prove the line with
  `ad wait text "…"`, `ad wait '<selector>'`, `ad is visible '<selector>'` or `ad get text
'<selector>'` — never with a screenshot alone.
- **Evidence.** One screenshot per line, after the check:

  ```bash
  .agents/scripts/device-lane.sh screenshot pr<PR>-<n>    # <main>/.worktrees/sim-shots/pr<PR>-<n>.png
  ```

  Read the image and say whether it shows what the line claims, quoting the visible text.
  Screenshots stay local and are never committed.

A lane `ad` command that exits 76 failed twice on the device side (CoreSimulator or the
XCUITest runner, not the app; the lane already retried once): `release`, `lease ios` again,
`install`, and repeat that line once. A second 76 is `unavailable` with the error line — never
loop, never sleep and retry by hand. The lane binary takes no OTA update, so the screen always
shows the PR's JS.

Every line ends `pass`, `fail`, or `not covered` (nothing on a device can show it, or the
selector the line needs does not exist — say which).

## 5. appduct, when the Agent hooks use it

```bash
.agents/scripts/device-lane.sh appduct link
.agents/scripts/device-lane.sh appduct ls
.agents/scripts/device-lane.sh appduct call <tool> '<json>'
```

A tool the hooks name but `appduct ls` does not list is a `fail` for the lines that rely on
it. `policy_denied` means the operator's policy refuses it (a destructive tool): use the UI
path instead and note it.

## 6. A failure: collect evidence once

For a `fail` that is not obvious from the snapshot (a request that fails, a value that never
arrives), collect one round of debug evidence on the same lease, then stop:

```bash
.agents/scripts/device-lane.sh build ios debug       # wait for its .exit as in step 2
.agents/scripts/device-lane.sh install
.agents/scripts/device-lane.sh metro start
.agents/scripts/device-lane.sh ad open com.callstack.apexfactory --foreground
.agents/scripts/device-lane.sh rozenite network call --tool startRecording
# reproduce the failing step with device-lane.sh ad …
.agents/scripts/device-lane.sh rozenite network call --tool listRequests
.agents/scripts/device-lane.sh rozenite console call --tool getMessages
```

Put what explains the failure under Evidence (a status code, an error message, a missing
request), one line each. Skip this step when the snapshot already explains it, or when the
debug build fails; the Release result stands either way.

## 7. Release — always

```bash
.agents/scripts/device-lane.sh release
```

It stops Metro, closes the agent-device session, and gives the device back to simlock (which
erases it for the next lane). Run it before the report on every path, including `fail` and an
error midway. If you cannot run it, say so under Evidence: the lease then expires on its TTL.

## Report

End with exactly this block, nothing after it:

```
PR: #M  Simulator: pass | fail | busy (<simlock line>) | unavailable (<reason>)
Device: <model> <os> <udid first 8> lease <lease id> | none
Ran: build <minutes> min, e2e <files or "none">, screenshots <n>; logs <paths>
Lines: <each Done when line, then pass | fail | not covered>
Evidence: <the failing step, request or text that differs, one per line, or "none">
```
