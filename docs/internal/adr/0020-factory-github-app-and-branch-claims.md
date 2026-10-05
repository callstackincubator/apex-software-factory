# 0020 — Unattended runs act as a GitHub App; the branch is the claim

Status: Accepted

## Context

Until now an unattended run used the maintainer's own `gh` login on the
runner (ADR 0012). Every comment, push, PR and merge looked like the
maintainer's own work, which is why rule 12 has agents sign with
`_Written by an agent._`. The login also reached every repository the
maintainer can reach, never expired, and tied the factory to whichever person
was logged in on the booth laptop.

The repository now has its own GitHub App, the Apex Software Factory. Its ID
and a private key are in the Actions secrets `FACTORY_APP_ID` and
`FACTORY_APP_PRIVATE_KEY`. Three facts shaped the design:

- An installation token lasts one hour. A run could last 80 minutes, and the
  job 90.
- The token has no user behind it. `gh` cannot resolve `@me` with it (GitHub
  answers `/user` and `viewer` with "Resource not accessible by
  integration").
- A bot cannot be an issue assignee: this repository's
  `GET /assignees/github-actions[bot]` answers 404. The claim was the
  assignee (rule 2), set with `--add-assignee @me`.

## Decision

1. **The run's GitHub identity is the app.** `factory.yml` mints an
   installation token with `actions/create-github-app-token`, for this
   repository only, and revokes it when the job ends. The run gets it as
   `GH_TOKEN`. The checkout's git credential helper is `gh auth
   git-credential`, so pushes use the same token. It is set in the checkout's
   local config, not with `gh auth setup-git`, which would rewrite the runner
   user's global git config. `factory-run.sh` exports `GIT_AUTHOR_*` and
   `GIT_COMMITTER_*` as `<slug>[bot]` with its noreply address
   (`<id>+<slug>[bot]@users.noreply.github.com`), looked up from the slug the
   action returns. A push or merge with an app token starts workflows, so CI
   and the OTA publish run as before.
2. **A run ends before its token expires.** The workflow records
   `FACTORY_TOKEN_EXPIRES` (mint time plus one hour). `factory-run.sh` moves
   its hard deadline to five minutes before that, if that comes before
   `FACTORY_TIMEOUT_MIN`. That leaves about 50 minutes for the run, restart
   included, and time to record the last attempt and post the handoff. The
   job's timeout drops to 75 minutes. Refreshing the token mid-run was
   rejected: it would need the private key on the runner, readable by agents
   that run as the same user. Runs take 18 to 30 minutes when nothing goes
   wrong.
3. **The claim is the issue's branch on origin**: `<kind>/<n>`, or
   `bug/<n>-repro` for a triage. `.agents/scripts/claim.sh <branch>` creates
   it from `main` through the API (a bug's from `bug/<n>-repro` when that
   exists). GitHub refuses to create a ref that exists, so the lock is atomic
   and needs no identity. `claim.sh --release <branch>` deletes the branch
   only when it has no commit `main` lacks. A branch with work stays as the
   other half of the handoff, and the issue stays claimed. Under the
   dispatcher an existing branch is an earlier run's work, and the run
   continues from it. Without the dispatcher it is someone else's claim, and
   the agent stops unless a person asked it to continue.
4. **Nothing releases claims automatically.** `issue-state.yml` drops its
   two release jobs: "PR closed without merge" and "no activity for six
   hours". Both only unassigned. The work stayed on the branch, and the next
   run started from it, which is what now happens anyway: the dispatcher never
   waits on a claim, so a dead run cannot hold an issue. `task:ready` →
   `task:draft` still leaves a claimed task alone, now checking for its
   branch. To start an issue over, a person deletes its branch.

## Consequences

- PRs, commits, comments and merges from unattended runs show the app's bot.
  People and automation can tell them from a person's work without the
  footer. The footer stays, because agents in a person's session (the
  console, the `build` agent) still post under that person's account.
- The token reaches one repository and expires within the hour. The
  maintainer's login on the runner is no longer used by unattended runs.
- The app has no Workflows permission, so an unattended run cannot push a
  change to `.github/workflows/`. That backs up safety rule 6.
- A run that needs more than about 50 minutes is stopped and handed off
  instead of running to 80. If that happens often, the next step is a token
  broker that keeps the key away from the agents, not a longer deadline.
- An issue shows no assignee while it is worked on. The issue's Development
  panel and the branch list show the claim instead.
- Squash merges leave the branch with commits `main` lacks, so a completed
  issue keeps its branch. Closed issues are never work, so this claims
  nothing. GitHub's "delete head branch" setting would remove such branches.
- Amends ADR 0012: the dispatcher's agents no longer act through the
  maintainer's `gh` login, and the watchdog's hard timeout also follows the
  token.
