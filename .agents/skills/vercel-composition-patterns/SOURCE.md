# Source

- Upstream: https://github.com/vercel-labs/agent-skills, commit
  `063bee94c3f4df8453406c830b0a7df0f2860278` (read 2026-10-05). MIT License (the repository's
  README; no license file).
- Files: `skills/composition-patterns/SKILL.md` and `rules/` → this directory.

## Local changes

- Formatted with `pnpm format` (oxfmt), like the rest of the repository; re-run it after an
  update.
- `metadata.opencode/autoinvoke: false` added to the frontmatter: the skill is left out of every
  agent's skill list, and only the implementer may load it, by name, from the table in the
  `implement` skill (ADR 0022).
- Left out: `AGENTS.md` (the rules compiled into one file; an `AGENTS.md` here would read as
  instructions for this directory), `README.md`, `metadata.json`, and the "Full Compiled
  Document" section that pointed at `AGENTS.md`.

## Updating

Take `SKILL.md` and `rules/` from a newer commit, re-apply the changes above, and update the
commit here.
