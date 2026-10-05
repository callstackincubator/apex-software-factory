# Source

- Upstream: https://github.com/callstackincubator/agent-skills, commit
  `61e6e7dfdf3a8ee862254c200d751fcb1fb863dc` (read 2026-10-05). MIT License, Copyright (c) 2026
  Callstack Incubator.
- Files: `skills/react-native-best-practices/SKILL.md` and `references/*.md` → this directory.

## Local changes

- Formatted with `pnpm format` (oxfmt), like the rest of the repository; re-run it after an
  update.
- `metadata.opencode/autoinvoke: false` added to the frontmatter: the skill is left out of every
  agent's skill list, and only the implementer may load it, by name, from the table in the
  `implement` skill (ADR 0022).
- The directory and `name` are `callstack-react-native-best-practices`: Software Mansion's
  skill has the same upstream name (`swm-react-native-best-practices`), and OpenCode keys a
  skill by its directory.
- Added: the "In this repository" section (no device and no profiling for the implementer; React
  Compiler is on).
- Left out: `references/images/` (6.5 MB of profiler screenshots; their links are broken
  here), `POWER.md` and `agents/openai.yaml` (wrappers for other tools).

## Updating

Take `SKILL.md` and `references/*.md` from a newer commit, re-apply the changes above, and
update the commit here.
