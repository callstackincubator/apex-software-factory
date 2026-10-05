# 0019 — Factory runs see only the repository's skills

Status: Accepted

## Context

OpenCode adds every skill it finds to each agent's system prompt. That covers
the repository's `.agents/skills/`, and also the global `~/.claude/skills`
and `~/.agents/skills` of whoever owns the machine. On the current factory Mac
those global directories hold 74 personal skills (Expo, Stripe, Figma, …),
31 KB of the prompt that no factory agent uses. The booth laptop will have a
different set, so the factory would behave differently on each machine.

The prompt shape also matters to the model endpoint. The `mobile-verifier`'s
first turn came back garbled in 9 of 11 runs (2026-10-04 to 05), each costing
about 5.5 minutes before a retry. A replay of the captured request garbled 5
of 5 times. Removing the skills list, or changing the tool list, made it
fine (diagnosis in `.worktrees/reports/` on the factory Mac; the repro was
reported to Callstack).

OpenCode 2.0.22 has no setting that turns global skill discovery off. Its
home directory can be overridden with `OPENCODE_TEST_HOME`, an undocumented
test hook. It moves only the home that OpenCode searches for `.claude` and
`.agents`. Auth and the database (`~/.local/share/opencode`), the global
config (`~/.config/opencode`) and the shell tools' own `HOME` stay as they
are.

## Decision

`factory-run.sh` exports `OPENCODE_TEST_HOME` set to an empty directory,
`.worktrees/opencode-home`. Every unattended run, and every subagent it
starts, sees only the repository's skills. The system prompt drops from about
27 KB to about 3 KB.

People's sessions (the `build` agent, the console) are unchanged.

## Consequences

- Factory prompts are smaller, and the same on every machine.
- The hook is not a public API. Before upgrading OpenCode, check that the
  first request of a factory run carries no global skills, for example by
  pointing a scratch `opencode.json` at a local logging proxy and checking the
  system prompt's size. If the hook is gone,
  the fallback is to keep `~/.claude/skills` and `~/.agents/skills` empty on
  the factory machine.
