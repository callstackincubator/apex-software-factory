# Source

- Upstream: https://github.com/expo/skills, commit `13ad8e05874195633b5c185f6947bb6400e228fc` (read 2026-10-05). MIT License,
  Copyright (c) 2025-present 650 Industries, Inc. (aka Expo). `LICENSE` (MIT, Copyright (c) 2026 Emil Kowalski) covers this skill's text and is kept.
- Files: `plugins/expo/skills/expo-animation/` → this directory, without `agents/openai.yaml`.

## Local changes

- Formatted with `pnpm format` (oxfmt), like the rest of the repository; re-run it after an
  update.
- `metadata.opencode/autoinvoke: false` added to the frontmatter: the skill is left out of every
  agent's skill list, and only the implementer may load it, by name, from the table in the
  `implement` skill (ADR 0022).

## Updating

Upstream has no releases; take the directory from a newer commit, re-apply the change above, and
update the commit here. Expo skills follow the SDK: check them against the `expo` version in
`apps/mobile/package.json` after an SDK upgrade.
