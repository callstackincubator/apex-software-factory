# Source

- Upstream: https://github.com/software-mansion-labs/skills, commit
  `e3f00cdb34942cee8b788abe10fe0d78a7f2b4e9` (read 2026-10-05). MIT License (the repository's
  README; no license file).
- Files: `skills/react-native-best-practices/SKILL.md` → `SKILL.md`;
  `references/{animations,gestures,svg,multithreading}/` → `references/`.

## Local changes

- Formatted with `pnpm format` (oxfmt), like the rest of the repository; re-run it after an
  update.
- `metadata.opencode/autoinvoke: false` added to the frontmatter: the skill is left out of every
  agent's skill list, and only the implementer may load it, by name, from the table in the
  `implement` skill (ADR 0022).
- The directory and `name` are `swm-react-native-best-practices`: Callstack's skill has the
  same upstream name, and OpenCode keys a skill by its directory.
- Each sub-skill's `SKILL.md` is renamed `index.md`. OpenCode discovers every `**/SKILL.md`
  under `.agents/skills/` as a skill of its own, which would put `animations`, `gestures` and
  the rest in every agent's list.
- Only four of the nine sub-skills are vendored, the ones for libraries in the booth binary
  (Reanimated, Gesture Handler, react-native-svg, react-native-worklets). Left out:
  `on-device-ai`, `rich-text`, `audio`, `jsi`, and `enable-worklets-bundle-mode` (it patches
  Metro and changes the Babel setup). The description and sub-skill table are cut to match, and the
  two pointers to the Bundle Mode sub-skill say it is not vendored.

## Updating

Take the files from a newer commit, re-apply the changes above, and update the commit here.
