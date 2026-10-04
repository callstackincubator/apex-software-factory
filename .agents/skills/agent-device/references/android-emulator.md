# Android Emulator

Vendored from upstream `skills/android-emulator/SKILL.md` (see `../SOURCE.md`) and adapted:
in this repo the emulator is leased from simlock and registered with simlock's own adb server.
`.agents/scripts/device-lane.sh lease android` takes it, and `device-lane.sh ad …` adds
`--platform android --serial <leased serial> --session apex-<branch>` and runs agent-device with
simlock's `ANDROID_ADB_SERVER_PORT` in a dedicated state directory. Never install agent-device,
never call `adb` or `emulator` yourself, never `adb kill-server` or `emu kill`.

Android is optional for the booth and less exercised than iOS: if `lease android` or a build
reports `unavailable`, report it and stop.

For a normal app-driving task, start immediately. Do not probe first with `--help`,
`--version`, `devices`, `appstate`, `snapshot`, or `screenshot`:

```bash
.agents/scripts/device-lane.sh ad open com.callstack.apexfactory --foreground
```

Follow the initial interactive snapshot and corrective error hints. Only when the task is
specialized or a command shape is unclear, read the relevant version-matched help topic:

```bash
pnpm exec agent-device help validate        # engineering validation and build freshness
pnpm exec agent-device help debugging       # screenshots, logs, traces, video, and failures
pnpm exec agent-device help react-native    # React Native and Expo runtime guidance
pnpm exec agent-device help scripting       # durable replay and CI workflows
```
