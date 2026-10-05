# 0016 — Factory memory on a branch, a record of every run, and a retro agent

Status: Accepted

Amends [0012](0012-allow-by-default-watchdog-dispatcher.md) (decision 3: the
watchdog also records each attempt).

## Context

Every factory improvement so far came from a person watching runs: reading
`factory-run.sh`'s logs and OpenCode's database on the booth Mac, timing
stages, spotting the same mistake twice, and writing an ADR (0009, 0011,
0014, 0015). That loop is slow and needs the one machine that ran the
factory. OpenCode's database (`~/.local/share/opencode/opencode.db`) never
leaves that machine, the run logs under `.worktrees/factory-runs/` are wiped
by the next job's checkout, and nothing a run learns reaches the next run:
each subagent starts fresh, so the third implementer to lose ten steps on the
same Jest setup loses them again. The database also records what the agents
did, not why: a stage that took 30 steps cannot say which instruction it was
missing.

## Decision

1. **Memory lives on a branch.** `factory-memory`, an orphan branch of this
   repository that is never merged, holds what the factory remembers. Every
   machine with a clone and the maintainer's `gh` login reads and writes it;
   no database, service or new secret. `.agents/scripts/memory.sh` is the
   only writer: it commits with git plumbing (no checkout), pushes as a
   fast-forward and retries on the tip when the other runner won a race.
2. **Lessons.** A stage may leave a lesson (`memory.sh lesson <topic> <by>
   <text>`): one or two sentences a later run would have saved steps
   knowing, that no skill states. Topics: `implement`, `device`, `ota`,
   `triage`, `deliver`. Each stage's skill starts with `memory.sh recall
   <topics>`, which prints the curated lessons, then the ten newest raw ones,
   framed as hints: a spec, a rule, an ADR or the skill wins on any conflict.
   A lesson is bounded (600 characters) and refused when it looks like a
   secret or holds an email address.
3. **Reviewers stay blind.** The spec reviewer, the code reviewer and the
   review verifier never recall: lessons and run records are written by
   sessions that saw the issue, which would be a channel around delivery
   rule 14. The spec reviewer has no shell at all. The code reviewer's and
   the review verifier's agent files deny `memory.sh` (but `journal`), the
   memory branch, `$FACTORY_JOURNAL`, `.worktrees/factory-runs/`, the
   journal, digest and transcript files by name, and OpenCode's database
   (`sqlite3`, `opencode.db`) the records are read from. The run directory
   deny also closes an older gap: the run's own log there names the issue.
   Shell denies match command text, so a command that reaches those files
   without naming them (a recursive `grep` from the parent directory) is not
   caught; the read, grep and glob tools' denies match the path itself.
4. **A journal per attempt.** `factory-run.sh` gives every attempt a journal
   (`FACTORY_JOURNAL`); any stage with a shell (every one but the spec
   reviewer, the blind code reviewer and review verifier included) adds a line with
   `memory.sh journal <by> <text>` when something outside the issue's own
   work cost it steps: a tool, a script, a missing or wrong instruction, a
   lesson that misled. It is the "why" the database cannot show.
5. **A record of every attempt.** After each attempt, `factory-run.sh` runs
   `.agents/scripts/run-record.sh`, which reads the attempt's session tree
   from OpenCode's database and writes a digest (per stage: time, steps
   against the cap, finish reasons, tokens, tool calls, repeated calls, tool
   errors, the task prompt and the report block; the journal; the log tail)
   and a full transcript (every message, one JSON line each). Both are
   redacted for anything shaped like a token, a key or an email address. The digest goes to the
   memory branch under `runs/`; `factory.yml` uploads the whole run directory
   as the job's artifact (`factory-run-<issue>-<run>-<attempt>`, 30 days),
   which also keeps the logs the next checkout would wipe.
6. **A retro agent.** `retro` (primary, `xhigh` variant, 120 steps, no
   question tool so it can also run unattended) with the `retro` skill and
   `/retro [scope]`: it reads the run records, GitHub (issues, PRs, handoffs,
   reviews, the dispatcher's runs) and, for a targeted question, a
   transcript artifact; classifies every loss (endpoint, instruction,
   tooling, spec, environment, memory); curates each topic's lessons into
   `curated/<topic>.md` and archives the raw ones; and writes a report with
   at most seven ranked proposals to `retros/` on the memory branch. With a
   person, it carries out the proposals they accept as a draft PR. It never
   changes `main` itself.
7. **Memory is a waiting room, not a rulebook.** A lesson that holds up
   across runs is promoted into the skill, rule or script it belongs to,
   through a PR a maintainer reviews (safety rule 6), and then dropped from
   memory. Nothing an agent writes to the branch becomes binding.

## Consequences

- The retro, and a person, can study any run from any machine: the digest on
  the branch with `git` alone, the transcript with `gh run download`, both
  without the booth Mac.
- Every attempt costs a few seconds and one push to the branch; a stage that
  recalls costs one tool call. Failures never stop a run: recall, lesson and
  journal say why and exit 0 (only a malformed call, an unknown topic or
  agent name, exits 64), and a missing record is only logged.
- A prompt-injected issue can now try to plant a lesson. Mitigations: lessons
  are framed as hints that lose to every rule, reviewers never see them, the
  retro reviews and curates them, and nothing reaches `main` without a
  person. The maintainer can read or delete anything on the branch at any
  time (`git log origin/factory-memory`).
- Transcripts hold everything the agents saw: issue text, diffs, command
  output. Redaction is best effort; the artifact is visible to anyone who can
  read the repository's Actions, so no secret may reach an agent's context in
  the first place (safety rule 1 already forbids it).
- The digest's tool-call sections read message fields OpenCode does not
  document; when a version changes them, those sections come back empty and
  the stage table, the prompts and the reports still work.
