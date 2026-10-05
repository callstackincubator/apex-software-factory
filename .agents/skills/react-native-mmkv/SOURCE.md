# Source

- Upstream: https://github.com/margelo/react-native-skills, commit
  `1e9e17be6f41c838db472d6a4b943fc26355a3be` (read 2026-10-05). The repository has no license
  file; this skill's frontmatter says `license: MIT`.
- Files: `skills/react-native-mmkv/` → this directory.

## Local changes

- Formatted with `pnpm format` (oxfmt), like the rest of the repository; re-run it after an
  update.
- `metadata.opencode/autoinvoke: false` added to the frontmatter: the skill is left out of every
  agent's skill list, and only the implementer may load it, by name, from the table in the
  `implement` skill (ADR 0022).

## Updating

Take the directory from a newer commit, re-apply the change above, and update the commit here.
The skill covers MMKV v4, the version pinned in `apps/mobile/package.json`.
