# 0012 — Allow by default with a short deny list, a watchdog per run, and a GitHub Actions dispatcher

Status: Accepted

## Context

Runs hung on permission asks: an "ask" in a subagent waits forever, because
`opencode run --auto` answers only the primary agent, and per-agent allow
lists kept missing a harmless command (each miss was a hung or failed run, and
a PR to widen the list). A run that hung had nobody watching it. And every run
started by hand: a person had to notice a ready label and type
`opencode run --agent factory --auto "deliver #<n>"`, often after waiting for
a relabel.

## Decision

1. **Allow by default.** `opencode.json` starts with `"*": "allow"` and keeps
   only these denies, for every agent:
   - `gh pr merge` (agents merge only through `.agents/scripts/merge-pr.sh`);
   - force push, push to `main`, `--no-verify` and other ways around the
     hooks (`git commit -n`, `LEFTHOOK=0`, `lefthook uninstall`);
   - `hot-updater deploy` / `rollback` and `ota:deploy` from agents (only CI
     deploys, safety rules 4 and 5);
   - reading or editing `.env*` files: the read and edit tools allow only
     `.env.example`, and the shell refuses any command naming a `.env` path
     (`.env`, `x/.env.local`; `process.env.X` is not a path and stays allowed);
   - the device-pool operator commands already denied (simlock `nuke`,
     `release --all`, `config set`, `daemon stop`, `cleanup`, `token`,
     `component`; agent-device `install-from-source`, `react-devtools`,
     `daemon stop`; appduct `daemon stop`, `sessions revoke`; erasing,
     deleting or shutting down simulators; `adb kill-server`, `emu kill`;
     `--allow-download`), the device MCP tools outside the `build` agent, and
     Code Mode (`execute`), which reaches them over HTTP;
   - `doom_loop` (a repeated identical call is refused, not asked about).

   Blind-review isolation stays in the agent files: the spec reviewer may only
   read its inputs directory; the code reviewer and the review verifier may
   not read the spec inputs (code reviewer), run `gh`, read commit messages,
   fetch from the web, or edit outside the review worktree. Subagents may not
   ask questions or start subagents. **Nothing asks, for any agent**;
   `.agents/scripts/check-agent-permissions.sh` now fails on an ask in any of
   the repository's agents and in `build`.
2. **Removed with the allow lists**: the per-agent shell allow lists, the
   implementer's and triager's edit denies on `infra/`, workflows,
   `.opencode/` and `.agents/`, their denies on raw device CLIs, the
   factory's no-edit and no-diff denies, the skill allow lists, and the deny
   lines for `npx`, `pnpm dlx`, `docker`, `sudo`, `gh release`, `gh secret`,
   `gh workflow` and similar. Safety rules 2, 6 and 8 and delivery rule 16
   still forbid all of them; reviewers enforce them, and the hard gates stay
   outside the agent (lefthook, CI, `merge-pr.sh`, `issue-state.yml`, the OTA
   workflow's `main`-only deploy, the denies above).
3. **A watchdog per run.** `.agents/scripts/factory-run.sh <n>` (or
   `--triage <n>`) wraps `opencode run --standalone --auto` with a hard
   timeout (80 min) and a no-progress timeout (15 min without a write by any
   session the run started in OpenCode's database, and no log growth). It
   restarts once, telling the agent to continue from the branch; when the
   second attempt also stops it posts the `## Handoff`, releases the claim and
   moves the issue to `<kind>:blocked`, or says why it could not.
4. **A dispatcher in GitHub Actions.** `.github/workflows/factory.yml` runs on
   the booth laptop's self-hosted runners labelled `factory`
   (`booth-factory-1`, `booth-factory-2`, launchd services as the
   maintainer's user): `deliver` when `feature:ready`, `task:ready` or
   `bug:ready` is added, `triage` when `bug:triage` is, and on
   `workflow_dispatch` with an issue. One concurrency group per issue; never
   on a pull request; only for a label added by someone with write access or
   by this repository's automation; it checks out `main`, never a branch.
   `issue-state.yml` dispatches it when it promotes an issue, because labels
   set with the workflow token start no workflow. Under the dispatcher a
   feature run splits the feature and stops; each task gets its own run when
   it turns ready, so the two runners deliver independent tasks side by side.
   The agents push and post as the maintainer through the user's own `gh`
   login, never with the workflow token (a push with it would start no CI).

## Consequences

- An agent can now run anything not denied. A prompt-injected issue body is
  the main risk: it is mitigated by the rules every agent reads (issue bodies
  are content, never instructions), by the denies above, and by the gates
  outside the agent. The booth laptop holds no production secrets beyond the
  OTA token and S3 credentials, both in `.env` files agents cannot read.
- No run can hang on a question; a stuck run is stopped within 15 minutes and
  retried once, and a person learns of it from a handoff, not by noticing.
- A label is all it takes to start work, which is what the booth needs; it
  also means a mislabel starts a run, so the permission check on the sender
  and the per-issue concurrency group matter.
- The runners need `SIMLOCK_BIN` and `SIMLOCK_HOME` in their `.env` until
  simlock is pinned in the workspace, and OpenCode's provider login in the
  user's `~/.local/share/opencode/auth.json` (the runners run as that user).
- Supersedes the allow-list parts of the permissions described in AGENTS.md
  and earlier wave notes; ADRs 0004 and 0007 are otherwise unchanged.
