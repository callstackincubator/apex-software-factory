# Source

- Upstream: https://github.com/callstack/agent-device, commit
  `ff259e7950f57967349511c02a2d3c5566fec8e1` (the `0.21.20` release commit, the version pinned in
  the root `package.json`). MIT License, Copyright (c) 2026 Callstack.
- Files: `skills/agent-device/SKILL.md` → `SKILL.md`; `skills/ios-simulator/SKILL.md`,
  `skills/android-emulator/SKILL.md`, `skills/dogfood/SKILL.md` → `references/`.
- The "Recommended agent rule" comes from https://oss.callstack.com/agent-device/docs/agent-setup
  (read 2026-10-04). It lives here, not in `AGENTS.md`, which must stay free of rules.

## Local changes

- Every device command goes through `.agents/scripts/device-lane.sh ad …` on a simlock lease;
  the lane adds `--udid`/`--serial`, `--ios-simulator-device-set` and `--session apex-<branch>`.
- Install instructions (`npm install -g agent-device@latest`) and the dogfood version check
  are removed: the pinned devDependency is the only agent-device used (safety rule 2).
- Upstream installs with `npx skills add callstack/agent-device`; that is denied here
  (`npx *`), so updates are vendored by hand.
- Added: the lane lifecycle, `.ad` replay scripts as the repo's `e2e:` tests, the app's
  selectors, and the commands the lane refuses.

## Updating

When the root `package.json` moves agent-device to a new version, take the skill files from the
commit that version was released from, re-apply the local changes above, and update the commit
here.
