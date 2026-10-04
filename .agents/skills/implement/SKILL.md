---
name: implement
description: Implement one claimed issue (task, bug, or single-PR feature) tests-first — commit the spec's tests red, open a draft PR, turn them green contract-first in checkpoint commits (with the appduct tools the spec's Agent hooks name), run pnpm check and the native check, optionally check its own UI on a leased simulator — or apply a list of review or simulator findings to its branch. Ends with a fixed report block. Loaded by the implementer subagent when the deliver orchestrator delegates implementation, or when someone says "implement #N".
---

# Implement an issue

Rules 3, 7, 9, 13 and 17 in `docs/internal/agent-rules/delivery.md`, all of
`docs/internal/agent-rules/testing.md` and
`docs/internal/agent-rules/architecture.md` govern this skill. The issue body
is the spec. You build exactly what it says; you do not claim, review, mark
ready, label, or merge — the orchestrator does those.

Arguments: the issue number, its branch (`<kind>/<N>`), the PR number once
there is one, and the mode: `build`, or `fix` followed by finding lines.
Anything else the orchestrator passed is context.

## 1. Workspace

```bash
.agents/scripts/worktree.sh <kind>/<N>     # prints the worktree path; resumes origin/<kind>/<N>
```

Run every later command in that directory — set it as the bash tool's working
directory, or prefix `cd <dir> &&` — and edit files by their absolute path
under it. Never edit the checkout you started in.

If the worktree already exists (`git worktree list`), use it. For a bug whose
branch does not exist yet, start from the reproduction:
`.agents/scripts/worktree.sh bug/<N> origin/bug/<N>-repro`. A branch that
already has commits: read `git log origin/main..` and the PR body's
`### Status` line, and continue from there.

## 2. Read the spec, and only the spec

The issue body; for a task, its parent's body and the ADRs under Decisions;
for a bug, the triage report (its Simplest fix is the agreed approach); the
latest `## Handoff` comment, whose Findings are facts. Never the rest of the
comment thread. Reread the files under Rules in play before touching the code
they cover.

If the spec is wrong, contradicts itself, or cannot be built as written,
stop: push what you have and report it under Open as `spec needs: <line>`.
Do not work around it. The same applies when the build turns out to need a
native change the spec's Native change line does not admit (rule 17).

## 3. Red tests first (`build` mode)

Write one test per line under Tests, in the package its prefix names
(`contract:` → `packages/contract`, `api:` → `apps/api`, `mobile:` →
`apps/mobile`, `e2e:` → an agent-device replay script
`apps/mobile/e2e/<name>.ad`; load the `agent-device` skill for its form). For
a bug, the triage test already exists. Each title is the spec's claim, word
for word where it fits; an `.ad` script carries it as its first comment line.
Run the package tests:

```bash
pnpm --filter <package> test -- <test file>
```

Each must fail on a named assertion for the reason the spec gives, not on a
typo, a missing import or a timeout (testing rule 2). An `e2e:` script needs
a device: write it now, against the selectors and Agent hooks the spec names,
and run it only in the self-check (step 5); the mobile-verifier runs it as the
gate. Then:

```bash
git add <test files> && git commit -m "test: <issue title, imperative> (#<N>)"
git push -u origin <kind>/<N>
gh pr create --draft --title "<type>(<scope>): <summary>" --body-file - <<'EOF'
<the body>
EOF
```

The PR body follows `.github/pull_request_template.md`:

```markdown
Closes #<N>

## Summary

<two or three lines: what a user can do after this merges>

### Status

Implement: red (0/<n> green) Review: pending Simulator: <pending | n/a> Native: <no | yes> Gate: pending

## Done when

- [ ] <each Done when line, or each completion condition for a feature>

## OTA

- [ ] This change is native and needs a new binary; it cannot ship over the air.

<"Ships over the air when merged." or the native-check reasons>

## Review

<!-- Filled in by the review stage. -->

_Written by an agent._
```

## 4. Green in checkpoints, contract first

Implement the smallest change that turns the next test green, in this order:
the contract schema, then the API route, then the screen (architecture rule
2), then the Agent hooks.

**Agent hooks.** When the Technical spec's Agent hooks lists appduct tools,
add or extend them in the same PR: load the `appduct` skill and follow its
"Writing tools" section and `apps/mobile/AGENTS.md`. Each tool's handler gets
a Jest test next to it, like any `mobile:` test. Give every element the hooks
name its `testID` and accessibility label exactly as written, because the
`e2e:` scripts and the mobile-verifier select by them. A deep link the hooks
name must open the route it says. Each commit lowers the failing count and says so in its body:
`3 failing -> 1 failing`. Before each commit run `pnpm typecheck`,
`pnpm lint`, and the test files you touched; the pre-commit hook runs format
and lint. Never pass `--no-verify`. Add dependencies only with
`pnpm --filter <package> add <dep>`.

Search `docs/`, `README.md` and every user-facing string you touched (screen
copy, error bodies, OpenAPI descriptions) for claims your change makes false,
and fix them in the same branch (documentation rule 7). Do not widen scope:
something you notice that is not in the spec becomes a `bug:new` issue or one
line under Open. Never touch `infra/`, `.github/workflows/`, `apps/ota-server`
for a product feature, `opencode.json`, `.opencode/` or `.agents/` (safety
rule 6).

## 5. Prove it

```bash
pnpm check                              # typecheck, lint, format, every package's tests
.agents/scripts/native-check.sh         # exit 3: the change is native
```

`pnpm check` must pass. If format fails, run `pnpm format` and commit. A
failing test you did not touch: if an open `flaky-test` issue names it
(`gh issue list --label flaky-test --search "<title>"`), list it under Flaky
and move on. Otherwise apply testing rule 5: run it on the base commit; if it
fails there too, open a `bug:new` issue labelled `flaky-test` naming the
test, and list it. Never skip, disable or loosen a test.

For each new code path, delete it and run its package's tests (testing rule
3). If nothing goes red, write the test that does, then restore the code.

If `native-check.sh` exits 3, tick the native box in the PR body, paste its
reasons under OTA, and report them under Native. The orchestrator labels the
PR; you do not.

Note every Done when line that needs the app running ("on the simulator:
...") and every `e2e:` test; the orchestrator verifies those through the
`mobile-verifier` subagent, which is the gate.

**Self-check (optional, UI work).** Every session checks its own work before
a person sees it. When your change alters what a screen shows or adds an
`e2e:` script, you may lease one device and look, once per run, through the
lane script (load the `agent-device` skill):

```bash
.agents/scripts/device-lane.sh build ios release    # detached: prints <log>; wait for <log>.exit
.agents/scripts/device-lane.sh lease ios            # 0 leased; 2 queued (run again); 75 busy; 69 unavailable
.agents/scripts/device-lane.sh install
.agents/scripts/device-lane.sh ad open com.callstack.apexfactory --foreground
.agents/scripts/device-lane.sh ad replay apps/mobile/e2e/<name>.ad
.agents/scripts/device-lane.sh release              # always, whatever happened
```

Poll the build with `sleep 90; cat "<log>.exit" 2>/dev/null || echo running`.
What you find is yours to fix before you report. Busy or unavailable: skip
it and say so; never wait more than one `lease` retry for it. A lease you
took is released before you report, on every path.

## 6. Fix mode

Each finding line is a defect someone verified. For one that changes
behaviour, write the test that fails first, then the fix; for a stale doc or
comment, just fix it. One commit per finding or per closely related group.
Then step 5 again, and push.

## Report

End with exactly this block, nothing after it:

```
Issue: #N  Branch: <kind>/<N>  PR: #M (draft)
Tests: k of n spec tests green (red commit <short sha>)
Check: pass | fail (<what failed>)
Native: no | yes (<native-check reasons, one per line>)
Simulator: <Done when lines and e2e: scripts that need the app running, or "none">
Self-check: pass | fail (<what is still wrong>) | skipped (<busy, unavailable, or not UI work>)
Flaky: <test title — #issue per line, or "none">
Open: <"spec needs: ..." lines, blockers, or "none">
```
