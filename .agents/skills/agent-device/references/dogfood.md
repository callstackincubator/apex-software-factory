# Dogfood (exploratory QA)

Vendored from upstream `skills/dogfood/SKILL.md` (see `../SOURCE.md`) and adapted: the
upstream version check and its `allowed-tools` line are dropped, because the pinned
devDependency is the only agent-device here, and every device command goes through
`.agents/scripts/device-lane.sh ad …` on a leased device.

Use it when someone asks to QA, dogfood, bug hunt or explore the app on a device. Read the
current CLI guidance first:

```bash
pnpm exec agent-device help dogfood
```

Loop: open the app (`device-lane.sh ad open com.callstack.apexfactory --foreground`) →
`ad snapshot -i` and `device-lane.sh screenshot <name>` → explore flows → capture evidence per
issue → `ad close`. Findings come from runtime behaviour, not from reading source. Let
`help dogfood` provide the report shape and evidence commands; each issue found becomes its own
`bug:new` issue (delivery rule 8), never a fix.
