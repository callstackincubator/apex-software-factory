# iOS Simulator

Vendored from upstream `skills/ios-simulator/SKILL.md` (see `../SOURCE.md`) and adapted: in
this repo agent-device is the workspace's pinned devDependency, the simulator is leased from
simlock, and every command goes through `.agents/scripts/device-lane.sh ad …`, which adds
`--platform ios --udid <leased UDID> --ios-simulator-device-set <simlock set> --session
apex-<branch>`. Never install agent-device (no `npm install -g`, no `npx`), never pass those
flags yourself, and never call `xcrun simctl` to boot, erase or install.

For a normal app-driving task, start immediately. Do not probe first with `--help`,
`--version`, `devices`, `appstate`, `snapshot`, or `screenshot`:

```bash
.agents/scripts/device-lane.sh ad open com.callstack.apexfactory --foreground
```

Follow the initial interactive snapshot and corrective error hints. If the lane reports
`unavailable`, stop and report it; do not work around it.

Only when the task is specialized or a command shape is unclear, read the relevant
version-matched help topic (help needs no device, so call the pinned CLI directly):

```bash
pnpm exec agent-device help validate        # engineering validation and build freshness
pnpm exec agent-device help debugging       # screenshots, logs, traces, video, and failures
pnpm exec agent-device help react-native    # React Native and Expo runtime guidance
pnpm exec agent-device help scripting       # durable replay and CI workflows
```

`help react-devtools` describes a command this repo does not allow (it fetches from npm);
use the `rozenite` skill's `react` domain instead.
