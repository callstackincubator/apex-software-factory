# Source

- Upstream: https://github.com/callstackincubator/rozenite, tag `v2.4.0`, commit
  `a2c7776f32ac7c2a007e9482dadb0f117a76bc0e` (the version of `rozenite` and the `@rozenite/*`
  plugins pinned in `apps/mobile/package.json`). MIT License, Copyright (c) 2025 Szymon Chmal.
- File: `packages/cli/skills/rozenite/SKILL.md` → `SKILL.md` (rewritten for this repo). The
  upstream skill is a router to `rozenite skills show <id>`, docs bundled with the CLI; those
  stay in the installed package and are read from there.

## Local changes

- Every agent call goes through `.agents/scripts/device-lane.sh rozenite …`, which targets the
  lane's own Metro port and caches the lane's Rozenite session.
- `npx rozenite …` becomes `pnpm exec rozenite …` from `apps/mobile` (`npx` is denied).
- Added: the debug-build-only constraint, the lane setup, and the 2.4.0 gotchas seen on this
  machine (session stop hangs; a session created before a reload misses plugin domains).
- Upstream installs with `npx skills add … --skill rozenite`; that is denied here, so updates
  are vendored by hand.

## Updating

Take the file from the tag matching the new pinned version, re-apply the changes above, and
update the commit here.
