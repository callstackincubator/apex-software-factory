# Devices runbook (booth laptop)

How agents reach a simulator or emulator on the booth laptop, and how to set
up, check and recover the host side. The tools:

| Tool | Pinned | Installed by | Role |
| --- | --- | --- | --- |
| agent-device | `0.21.20`, root devDependency | `pnpm install` | every agent interaction with a device |
| appduct | `0.14.0`, root devDependency (CLI) + `@appduct/react-native` in the app | `pnpm install` | shortcuts into the running app (tools, events) |
| Rozenite | `2.4.0`, `apps/mobile` devDependencies | `pnpm install` | debugging a debug build through Metro |
| simlock | 0.3.0, not on npm yet | the maintainer (`SIMLOCK_BIN`) | simulator and emulator leasing; see [simlock](#simlock) |

How an agent uses them, command by command, is in
[apps/mobile/README.md](../../apps/mobile/README.md#agent-tooling). This file
is the host side. Nothing here is installed globally; everything runs as
`pnpm exec <tool>` from the checkout (safety rule 2). A global `agent-device`
from an earlier experiment may be on the PATH: ignore it, it is older.

## Ports and state

| What | Where | Notes |
| --- | --- | --- |
| agent-device daemon | `127.0.0.1`, random port, token in `~/.agent-device/daemon.json` | one per user; replaces an older-version daemon on first use |
| agent-device iOS runner | `~/.agent-device/apple-runner/derived` | XCUITest runner built on first use per Xcode version (minutes) |
| appduct daemon | `~/.appduct/daemon.sock` (0600) + TLS WebSocket `:8443` | auto-spawned by the first `appduct` command; the app connects to 8443 |
| appduct state | `~/.appduct/` (`key.pem`, `audit/`, `daemon.log`, optional `config.json`) | never commit; never point `--state-dir` at a project |
| appduct project config | `apps/mobile/.appduct/config.json` (committed) | scheme `apexfactory`, app ids |
| Metro (dev loop) | `:8081` | `pnpm --filter @apex/mobile start:agent` = Metro with `WITH_ROZENITE=true APPDUCT_ENABLED=1` |
| Rozenite agent routes | Metro `/rozenite/agent/*` | only while Metro runs with `WITH_ROZENITE=true` |
| Rozenite artifacts | `apps/mobile/.rozenite/` (gitignored) | traces, heap snapshots |

## Environment variables

| Variable | Set where | Value |
| --- | --- | --- |
| `APPDUCT_ENABLED` | package scripts; CI deploy | `1`, always. One build profile: Debug and Release link appduct's native module, OTA bundles keep its JS. It changes the iOS fingerprint, so every prebuild, fingerprint and deploy uses the same value; `hot-updater.config.ts` refuses anything else. |
| `WITH_ROZENITE` | only `start:agent` | `true` turns Rozenite on in Metro. Never set in CI or for a release/OTA build. |
| `AGENT_DEVICE_NO_UPDATE_NOTIFIER` | the agent's environment | `1`: no background npm check (safety rule 2). |
| `ANDROID_HOME` | the shell / runner | `$HOME/Library/Android/sdk` (not set by default on a Mac). |
| `JAVA_HOME` | the shell / runner | `/Library/Java/JavaVirtualMachines/zulu-17.jdk/Contents/Home` (JDK 17). |
| `LANG`, `LC_ALL` | any iOS build | `en_US.UTF-8`, or CocoaPods may fail. |

## One-time host setup

```sh
pnpm install                                         # all three CLIs, pinned
export AGENT_DEVICE_NO_UPDATE_NOTIFIER=1
pnpm exec agent-device doctor --platform ios         # Xcode, devices; warms the runner cache
pnpm exec agent-device prepare ios-runner --platform ios --udid <UDID> --timeout 240000
pnpm exec appduct --version                          # 0.14.0
```

- `agent-device doctor` must end `Doctor: pass`. It also starts building the
  iOS runner in the background; `prepare ios-runner` does it in the
  foreground (several minutes the first time per Xcode version).
- appduct needs no key or config for simulators: its daemon makes a key on
  first start and the pairing link carries the pin (`trust: "link"`, no
  `cliPins` in the binary). `allowPrivateLanOnly: true` keeps the app from
  connecting to anything but loopback/private addresses.
- Operator policy for unattended runs — create `~/.appduct/config.json`:

  ```json
  { "policy": { "default": "allow", "destructive": "deny" } }
  ```

  Tools marked `destructiveHint: true` (today `reload_app`) are then refused
  with `policy_denied` for every caller; agents use the UI instead (tap the
  banner). The daemon reads this file only at start:
  `pnpm exec appduct daemon stop` (drops all sessions; apps re-pair).
  Every call is logged in `~/.appduct/audit/`.
- Android: `export ANDROID_HOME=$HOME/Library/Android/sdk JAVA_HOME=…zulu-17…`
  and put `$ANDROID_HOME/platform-tools` and `$ANDROID_HOME/emulator` on the
  PATH. AVDs present: `Pixel_8`.

## Every booth day

```sh
xcrun simctl list devices booted                     # which simulator, its UDID
pnpm exec agent-device doctor --platform ios
pnpm exec appduct daemon status                      # starts on demand anyway
```

Agents always pass the device explicitly (`--udid` for agent-device,
`--device` for appduct) — several simulators may be booted, and other apps on
the laptop may connect to the same Metro.

## Build, install, pair (what the agent does)

```sh
# Debug (dev loop): build once, then Metro
pnpm --filter @apex/mobile ios --device <UDID> --no-bundler
pnpm --filter @apex/mobile start:agent

# Release (the booth binary): LAN URLs baked in, appduct linked
cd apps/mobile
LANG=en_US.UTF-8 APPDUCT_ENABLED=1 \
  EXPO_PUBLIC_OTA_URL=http://<lan-ip>:3002/hot-updater EXPO_PUBLIC_API_URL=http://<lan-ip>:3001 \
  pnpm exec expo run:ios --configuration Release --no-bundler --device <UDID>
pnpm exec appduct doctor ~/Library/Developer/Xcode/DerivedData/ApexFactory-*/Build/Products/Release-iphonesimulator/ApexFactory.app --assert-present

# Pair appduct with the running app (from apps/mobile)
pnpm exec appduct sessions link --open ios-sim --device <UDID> --json
```

The first link on a simulator raises iOS's "Open in Apex Factory?" sheet:
`pnpm exec agent-device press 'label="Open"'`. Or let agent-device deliver
the link (it accepts the sheet): `appduct sessions link --json`, then
`agent-device open com.callstack.apexfactory '<data.deepLink>' --udid <UDID>`.
A session survives JS reloads and backgrounding; a relaunch (`open
--relaunch`, `replay` with `open … --relaunch`) kills the process, so pair
again.

## Recovery

| Symptom | Fix |
| --- | --- |
| `DEVICE_IN_USE` / "owned by session" from agent-device | Another agent-device session holds the simulator. `pnpm exec agent-device device status --platform ios --udid <UDID>`; the owner closes with `agent-device close`. |
| An `xcodebuild test-without-building … AgentDeviceRunner` process outlives its session | Orphaned runner. Check its `-xctestrun` path names your UDID, then `kill <pid>`; the next `open` starts a fresh one. |
| `Replacing daemon … version mismatch` | Normal after a version bump; the pinned CLI replaces the old daemon. |
| `appduct tools ls` → `unknown_session` right after `link --open` | The app never claimed the link: the "Open in" sheet is up (press Open), or the app was not running. Mint a new link (one use, 5 min). |
| appduct `ambiguous_session` | Two apps paired: pass the session id or alias (`appduct sessions ls`). |
| appduct version mismatch after an upgrade | `pnpm exec appduct daemon stop` (drops sessions), re-pair. |
| `policy_denied` | The operator policy refuses that tool (`~/.appduct/config.json`); use the UI path. |
| `rozenite agent targets` empty | Metro not started with `start:agent`, or the app is a release build. |
| `rozenite agent domains` lacks `app`/`controls`/`network-activity` | The session was created before the app (re)loaded: `session stop`, reload the app, `session create` again. |
| `rozenite agent session stop` hangs | Seen on 2.4.0; interrupt it — the session ends with Metro or the app. |
| Two targets with the same name in `rozenite agent targets` | Another app on the laptop uses this Metro. Read `app_info` through `app.app_info` to confirm the target. |

## simlock

Every lane leases its device from simlock through
`.agents/scripts/device-lane.sh` (ADR 0007, delivery rule 16). simlock 0.3.0
keeps its simulators in a private device set and its emulators behind its
own adb server; the lane passes both to agent-device on every call, and pairs
appduct by opening the link with agent-device, because `appduct sessions link
--open ios-sim` only sees the default set.

simlock is not on npm yet, so the lane runs the CLI named by `SIMLOCK_BIN`, a
command line, with its state under `SIMLOCK_HOME` (keep it short: it holds
sockets):

```sh
export SIMLOCK_BIN="node /Users/aitwar/Projects/simlock/dist/cli/main.js"
export SIMLOCK_HOME=/tmp/apex-slk
.agents/scripts/device-lane.sh status       # the daemon, its capacity and queue
```

The factory runners get both from their `.env` files (see
[DELIVERY.md](DELIVERY.md#the-factory-dispatcher)). Once simlock is a root
devDependency, `pnpm exec simlock` wins and the variables can go.

## Native build cache

`device-lane.sh build` reuses a native build when it can (ADR 0010). The key
is the platform, the profile and the OTA fingerprint
(`pnpm --filter @apex/mobile run ota:fingerprint` prints it); the entries live
in `~/.cache/apex-software-factory/native/<platform>/<fingerprint>/<profile>/`.

- **Hit, Release**: a copy of the cached app with this worktree's JS bundle
  (Hermes bytecode), assets and Expo config swapped in. No Xcode, no build
  slot; well under a minute.
- **Hit, Debug**: the cached app as it is (it loads JS from Metro).
- **Miss**: a full build in a build slot, then the binary is stored under the
  hash it embeds. Precompiled Expo modules and React Native's prebuilt core
  keep a warm-machine Release build around 4 minutes; third-party native
  libraries compile from source.

```sh
node tools/expo-build-cache/cli.js list                       # what is cached
node tools/expo-build-cache/cli.js fingerprint ios apps/mobile
APEX_BUILD_CACHE=0 .agents/scripts/device-lane.sh build ios release   # force a full build
```

The same cache serves `npx expo run:ios|android` for simulator and emulator
builds once `apps/mobile/app.json` has
`"buildCacheProvider": { "plugin": "../../tools/expo-build-cache/provider.plugin.js" }`.
Delete a bad entry with `rm -rf` on its directory. `.agents/scripts/prewarm.sh`
fills the cache for the current fingerprint and warms simlock's pool and
agent-device's runner each morning.

## Machine setup log

Machine-level steps taken on the **temporary dev Mac** (4 Oct 2026) while
wiring these tools, in order (steps 12 on: the factory-speed wave). The OTA side is in
[OTA.md](OTA.md#machine-setup-log). No secrets here.

1. `pnpm install` in the agent worktree (nothing global). The rozenite CLI
   pulls in Electron; `pnpm-workspace.yaml` denies its build script, so
   nothing was downloaded.
2. `pnpm exec agent-device doctor --platform ios` replaced a running
   agent-device daemon v0.21.4 (an earlier global install) with 0.21.20 in
   `~/.agent-device`, and built the iOS runner cache in the background
   (Xcode 26.6, iPhone 17 Pro / iOS 26.5, UDID `395064D5…`).
3. First `appduct` command spawned the daemon: `~/.appduct/` created
   (`key.pem`, `daemon.sock`, `audit/`, logs), listening on `127.0.0.1:8443`.
4. Debug build installed on the booted iPhone 17 Pro:
   `LANG=en_US.UTF-8 APPDUCT_ENABLED=1 pnpm exec expo run:ios --configuration Debug --device <UDID> --no-bundler`
   (prebuild + `pod install` + compile, ≈ 10 min cold).
5. Metro started with `pnpm --filter @apex/mobile start:agent` (port 8081).
6. Product API started from the worktree for `api_health` (`node src/main.ts`
   in `apps/api`, port 3001), stopped afterwards.
7. One orphaned agent-device runner (`xcodebuild test-without-building`,
   parent launchd, for this UDID, alive 2 h 20 min) was killed after a
   session ended without `close`.
8. Release build with appduct installed over the debug one (see
   [OTA.md](OTA.md#machine-setup-log), step 9); Metro stopped first.
9. `~/.appduct/config.json` created with the policy above
   (`destructive: deny`) and the appduct daemon restarted; sessions re-paired.
10. Android release APK with appduct (`ANDROID_HOME`, `JAVA_HOME` set per
    command, never globally): `APPDUCT_ENABLED=1 … expo prebuild --platform
    android --no-install`, then `cd android && APPDUCT_ENABLED=1 ./gradlew
    assembleRelease` — `[appduct] native module INCLUDED in this build`,
    `BUILD SUCCESSFUL in 7m 50s`; `appduct doctor app-release.apk
    --assert-present` holds; manifest `com.hotupdater.FINGERPRINT_HASH` =
    `c273005b…` (= `fingerprint.json`).
11. AVD `Pixel_8` booted headless (`emulator -avd Pixel_8 -no-window
    -no-audio -no-snapshot-save`), APK installed with `adb install -r`;
    `agent-device open com.callstack.apexfactory --platform android --serial
    emulator-5554` worked (its helper APKs installed themselves);
    `appduct sessions link --open android --device emulator-5554` paired;
    `app_info` and `show_update_banner` answered from the Release build.
    The emulator was shut down afterwards (`adb emu kill`). An OTA deploy to
    Android was not exercised.
12. Native build cache created by the first lane build:
    `~/.cache/apex-software-factory/native/ios/e69a1971…/release/ApexFactory.app`
    (a full Release build, 244 s). Nothing else is installed for it.
13. The factory runners' `~/actions-runner-factory-{1,2}/.env` got
    `SIMLOCK_BIN=node /Users/aitwar/Projects/simlock/dist/cli/main.js` and
    `SIMLOCK_HOME=/tmp/apex-slk` (the simlock daemon already running from
    earlier testing), and both services were restarted
    (`./svc.sh stop && ./svc.sh start` in each directory).
