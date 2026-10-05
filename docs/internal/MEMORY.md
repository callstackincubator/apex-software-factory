# Memory, run records and the retro

How the factory learns from its own runs (ADR 0016). Agents leave lessons
for later runs and journal lines about what cost them time; every run attempt
leaves a record; the `retro` agent reads all of it, from any machine, and
proposes changes that a person accepts or not.

```text
  factory run (booth Mac)                       factory-memory branch            retro (any machine)
  ───────────────────────                       ─────────────────────            ───────────────────
  stage recalls lessons  ◄──────────────────── curated/ + lessons/  ◄─────────── curates, archives
  stage writes lesson    ─────────────────────► lessons/<topic>/
  stage writes journal   ─► <log>.journal.md
  factory-run.sh, after each attempt:
    run-record.sh        ─► digest ───────────► runs/<YYYY-MM>/       ──────────► reads
                         ─► transcript ─► Actions artifact (30 days)  ──────────► gh run download, one question
                                                retros/<date>.md      ◄────────── report, proposals ─► draft PR
```

## The memory branch

`factory-memory` is an orphan branch: no code, never merged, never a PR base.
`.agents/scripts/memory.sh` writes it with git plumbing (no checkout, so the
commit hooks have nothing to check) and pushes it as a fast-forward,
retrying when the other runner won a race. Nobody needs to create it: the
first write does, with a README. If the repository's rules restrict who may
create or push branches, the maintainer's login must be allowed to push
`factory-memory`; force pushes stay denied, and the script never needs one.

| Path                      | What                                                    | Written by       |
| ------------------------- | ------------------------------------------------------- | ---------------- |
| `lessons/<topic>/<id>.md` | One lesson, not yet curated                             | any stage        |
| `curated/<topic>.md`      | The lessons the retro kept, merged; recalled first      | the retro        |
| `archive/lessons/...`     | Raw lessons the retro folded in or dropped              | the retro        |
| `runs/<YYYY-MM>/<run>.md` | One digest per factory run attempt                      | `run-record.sh`  |
| `retros/<date>.md`        | Retro reports                                           | the retro        |

To look at it yourself:

```bash
.agents/scripts/memory.sh recall implement device ota triage deliver
.agents/scripts/memory.sh runs --since 2026-10-07       # or --issue 42
.agents/scripts/memory.sh show runs/2026-10/<run>.md
git log --stat origin/factory-memory                    # after: git fetch origin factory-memory
```

To delete something (a wrong lesson, a record that holds what it should not),
check the branch out in a scratch worktree, `git rm`, commit and push; or
`memory.sh archive lessons/<topic>/<id>.md` for a lesson. A secret that
reached the branch is reported to the maintainer at once and the token
revoked; deleting the file does not remove it from history (safety rule 1).

## Lessons

| Topic       | Recalled by                                | About                                                 |
| ----------- | ------------------------------------------ | ----------------------------------------------------- |
| `implement` | implementer, triager                       | the monorepo, its tests and tooling, `pnpm check`     |
| `device`    | mobile-verifier, ota-verifier, triager     | device lanes, builds, agent-device, appduct, Rozenite |
| `ota`       | ota-verifier                               | the publish run, update checks                        |
| `triage`    | triager                                    | reproducing and reporting bugs                        |
| `deliver`   | factory                                    | orchestrating stages, the gate, parking               |

A lesson is a fact a later run would have saved steps knowing and that no
skill states, in one or two sentences with the command or path. Most runs
leave none, never more than two. It is never about one issue's product, never
a secret, never a visitor's personal details; `memory.sh` refuses text that
looks like a token or holds an email address, and anything over 600
characters.

`recall` prints the curated file, then the ten newest raw lessons per topic,
under a header that frames them as hints: a spec, a rule, an ADR or the skill
wins over any lesson, and a lesson that proved wrong goes in the journal.

The three blind reviewers never recall: lessons come from sessions that saw
the issue, so they would be a way around delivery rule 14. The spec reviewer
has no shell, so it neither recalls nor journals. The code reviewer's and the
review verifier's agent files deny `memory.sh` except `journal`, the memory
branch, `$FACTORY_JOURNAL`, `.worktrees/factory-runs/`, the journal, digest
and transcript files by name, and OpenCode's database (`sqlite3`,
`opencode.db`). Their shell denies match command text, not the files a
command ends up reading; the read, grep and glob tools match the path.

## Journal lines

`factory-run.sh` sets `FACTORY_JOURNAL` to `<log>.journal.md` for each
attempt, and every agent the attempt starts inherits it. A stage writes one
line when something outside the issue's own work cost it steps or failed: a
tool, a script, a missing or wrong instruction, a lesson that misled. The
factory writes one whenever a stage ran again, a run resumed, a review went
to round 2, or it parked. A lesson is copied into the journal too. Outside a
factory run (`FACTORY_JOURNAL` unset) a journal line is not recorded.

## Run records

After every attempt, stopped or not, `factory-run.sh` runs
`.agents/scripts/run-record.sh`. From OpenCode's database it takes the
attempt's top session and every subagent session under it, and writes next
to the log:

- `<log>.digest.md`: when and how the attempt ended, the factory code
  commit, the model; a table of stages (start, time, steps against the cap,
  finish reasons, outcome, output, reasoning and peak prompt tokens, task);
  tool calls per stage, calls repeated three times or more, tool errors; each
  stage's task prompt and last text (its report block); the journal; the log
  tail. It is pushed to the memory branch under `runs/`.
- `<log>.transcript.jsonl.gz`: every message of those sessions, one
  `{session, agent, parent, seq, type, time, data}` line each, where `data`
  is OpenCode's own message.

Both pass through a redaction filter for anything shaped like a GitHub,
OpenAI-style, AWS or Slack token, an AWS secret key, a private key, a
`token=`/`Bearer` value, or an email address (`[email]`, which also catches
`git@github.com`). Redaction is a backstop: the rule is that no secret reaches an agent.

Under the dispatcher, `factory.yml` uploads `.worktrees/factory-runs/` as the
job's artifact `factory-run-<issue>-<run id>-<run attempt>`, kept 30 days.
The next job's checkout cleans that directory, so the artifact is where the
logs survive:

```bash
gh run download <run id> -n factory-run-<issue>-<run id>-<attempt> -D /tmp/run
```

The tool-call sections read message fields OpenCode does not document
(as of 2.0.22: `content[]` parts of `type` `tool`, with `.name`,
`.state.input`, `.state.status` and `.state.error.message`); when an OpenCode upgrade
changes them those sections say "not recorded" and the rest still works. The
stage table uses the fields `factory-run.sh` already relies on.

## The retro

`/retro [issues | since <date>]` in OpenCode, or unattended:

```bash
opencode run --agent retro -m "callstack.ai/callstack/Apex#xhigh" --auto "retro since 2026-10-07"
```

(`opencode run --agent` ignores the agent's own variant, so pass it with
`-m`, as `factory-run.sh` does.)

It needs `git`, `gh` (with access to issues, PRs and Actions) and the
memory branch; never the database. It builds a timeline per run, classifies
every loss (endpoint, instruction, tooling, spec, environment, memory),
curates each topic's lessons, and writes a report to `retros/` with at most
seven proposals ranked by what they would save, each with its evidence and
the exact file to change. With you in the session, tell it which proposals to
carry out: it makes them on a `retro/<date>` branch and opens a draft PR for
you to review. Unattended it stops at the report. It never merges, and
nothing it or any agent writes to the memory branch is binding until a
person merges the change into a skill, a rule or a script.

A good rhythm at the booth: one retro each evening on the day's runs, and the
accepted proposals merged before the next morning's prewarm.
