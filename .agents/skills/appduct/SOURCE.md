# Source

- Upstream: https://github.com/callstackincubator/appduct, tag `v0.14.0`, commit
  `72ab192640986acc42e750086b9fd00ca17cc9d4` (the version pinned for `appduct` in the root
  `package.json` and `@appduct/react-native` in `apps/mobile`). MIT License, Copyright (c)
  Szymon Chmal and Callstack.
- Files: `skills/appduct/SKILL.md` → `SKILL.md` (rewritten for this repo);
  `skills/appduct/references/{cli,setup,writing-tools}.md` → `references/` (verbatim, with a
  one-line note on top).

## Local changes

- Every factory call goes through `.agents/scripts/device-lane.sh appduct …`, which pairs the
  app through agent-device inside simlock's device set and keeps the lane's session id.
- Added: this app's tool table, where feature tools live, the operator policy's effect
  (`destructiveHint` tools are denied unattended), and the MCP split (only the interactive
  `build` agent has the MCP server).
- Upstream installs with `npx skills add callstackincubator/appduct --skill appduct`; that is
  denied here (`npx *`), so updates are vendored by hand.

## Updating

Take the files from the tag matching the new pinned version, re-apply the changes above, and
update the commit here. appduct is pre-1.0 and breaks between minors: reread `SKILL.md`'s
command shapes against `pnpm exec appduct --help` after every bump.
