# Devices runbook (Expo Simulators)

How agents reach a simulator or emulator, and how to run, check and recover a
lane. Decision records: [ADR 0028](adr/0028-device-lanes-on-expo-simulators.md)
(sessions), [ADR 0027](adr/0027-lane-binaries-repacked-on-eas.md) (the
binary). A device is an [Expo Simulators](https://docs.expo.dev/) session on
EAS; nothing runs on the machine that drives it except the CLIs and a tunnel.

| Tool         | Pinned                                                        | Installed by   | Role                                               |
| ------------ | ------------------------------------------------------------- | -------------- | -------------------------------------------------- |
| agent-device | `0.21.20`, root devDependency                                 | `pnpm install` | every agent interaction with a device              |
| appduct      | `0.14.0`, root devDependency (CLI) + `@appduct/react-native`  | `pnpm install` | shortcuts into the running app (tools, events)     |
| `eas-cli`    | `27.4.1`, run as `npx -y eas-cli@27.4.1` by the lane scripts  | the scripts    | the session, the egress tunnel, the lane binary    |

How an agent uses them, command by command, is in
[apps/mobile/README.md](../../apps/mobile/README.md#agent-tooling). Nothing
here is installed globally; everything runs as `pnpm exec <tool>` from the
checkout (safety rule 2). A global `agent-device` on the PATH is older: ignore
it.

## What a lane is

One worktree, one session, one agent-device session, all through
[`.agents/scripts/device-lane.sh`](../../.agents/scripts/device-lane.sh)
(delivery rule 16). `device-lane.sh` with no arguments prints its usage.

1. **`lease <ios|android>`** takes the lane binary of the checkout: the
   `production` EAS build with the same native fingerprint, repacked by the
   `lane-binary` EAS workflow with this checkout's JS and the `lane` channel
   (`.agents/scripts/lane-binary.sh`). The first lease of a commit waits for
   it (a repack takes minutes, a full `lane` build up to fifteen) and exits 2
   while waiting: run it again. `--production` takes the finished
   `production` build instead, for the OTA check (a lane binary never adopts
   an update); `--build-id <id>` takes any build.
2. It starts `eas simulator:start --type agent-device`, named
   `apex-<branch>` and tagged `apex`, with a 40-minute cap (the account
   maximum) and a 15-minute idle cap, and an egress tunnel to this machine
   (`eas simulator:egress`).
3. **`appduct link`** pairs the running app: it mints a link and opens it
   through agent-device, accepting iOS's "Open in Apex Factory?" alert. The
   simulator can reach only the appduct daemon on this machine, through the
   tunnel.
4. **`ad …`**, **`appduct …`**, **`screenshot`**, **`record`** drive and
   record the app. Screenshots and videos land in
   `<main checkout>/.worktrees/sim-shots/`.
5. **`release`** stops the session and the tunnel and deletes the session
   file. Safe to repeat, and after a lease that failed halfway. The caps are
   only the backstop for an agent that died.

Exit codes: 0 done, 1 failed, 2 still building the binary, 64 usage, 69
unavailable (no `npx`, not signed in to EAS), 75 busy (EAS refused the session
for capacity or a concurrency limit), 76 an `ad` command failed twice on the
device side.

## State and environment

| What | Where | Notes |
| --- | --- | --- |
| Lane state | `<worktree>/.apex/` (gitignored) | `device.json` (session, tunnel, appduct session), `logs/`, `build-<platform>` (the last binary's build id and commit) |
| Session credentials | `apps/mobile/.env.eas-simulator` (gitignored) | The agent-device daemon URL and token that `simulator:start` writes. A secret: never printed, deleted by `release` |
| appduct daemon | `~/.appduct/` on the machine running the lane; TLS WebSocket `:8443` | Starts with the first `appduct` command; the app connects to it through the tunnel |
| appduct project config | `apps/mobile/.appduct/config.json` (committed) | scheme `apexfactory`, app ids |

| Variable | Value |
| --- | --- |
| `EXPO_TOKEN` | The EAS robot token. On a runner it comes from the job; on a laptop, `eas login` also works |
| `APEX_APPDUCT_ENDPOINT` | `host:port` the app should reach the appduct daemon on, when the probe cannot read it |
| `APEX_EGRESS_ALLOW` | Space-separated `host:port` entries the session may also reach, for example the product API when an `.ad` script needs it (`api-latency.ad`) |
| `APEX_LEASE_WAIT` | Seconds one `lease` call waits for the binary (default 540) |
| `APEX_SESSION_MAX_MINUTES`, `APEX_SESSION_IDLE_MINUTES` | The caps (default 40 and 15) |
| `APPDUCT_ENABLED` | `1`, always: every `eas.json` profile and the workflows set it, and it changes the iOS fingerprint |
| `AGENT_DEVICE_NO_UPDATE_NOTIFIER` | `1`: no background npm check (safety rule 2) |

## Run a lane yourself

From a checkout with the app's JS you want to see, signed in to EAS (`eas
whoami`, or `EXPO_TOKEN` set):

```sh
pnpm install
.agents/scripts/device-lane.sh lease ios        # run again while it exits 2
.agents/scripts/device-lane.sh appduct link
.agents/scripts/device-lane.sh ad snapshot -i
.agents/scripts/device-lane.sh ad replay apps/mobile/e2e/home.ad
.agents/scripts/device-lane.sh screenshot home
.agents/scripts/device-lane.sh release
```

The `agent-device` and `appduct` MCP servers in `opencode.json` are for a
person in the `build` agent; every other agent is denied their tools and uses
the script.

## Operator policy

appduct refuses tools marked `destructiveHint: true` (today `reload_app`) when
`~/.appduct/config.json` says so:

```json
{ "policy": { "default": "allow", "destructive": "deny" } }
```

A runner VM starts without that file, so the daemon uses its defaults. Create
it on a machine you run lanes from; the daemon reads it only at start
(`pnpm exec appduct daemon stop`). Every call is logged in
`~/.appduct/audit/`.

## Debugging in a debug build

A lane cannot run Metro: its binary is a Release build and the session
reaches no dev server. To debug with React DevTools data (Rozenite), use your
own simulator or phone:

```sh
pnpm --filter @apex/mobile ios --no-bundler
pnpm --filter @apex/mobile start:agent        # Metro with WITH_ROZENITE=true APPDUCT_ENABLED=1
```

Rozenite is never in CI, a lane or an OTA bundle (safety rule 9).

## Recovery

| Symptom | Fix |
| --- | --- |
| `lease` exits 2 | The lane binary is still building; run `lease` again. A full `lane` build means the `production` build for this fingerprint does not exist (a native change, or an `eas.json` edit). |
| `lease` exits 69 | Not signed in to EAS, or no `npx`: set `EXPO_TOKEN` or run `eas login`. |
| `lease` exits 75 | EAS refused the session (capacity or the account's concurrency limit). Wait, or release stale sessions: `device-lane.sh status`, and in the Expo dashboard sessions tagged `apex`. Delivery parks the PR `needs-simulator` after 30 minutes. |
| `lane-binary.sh` fails | The EAS workflow `lane-binary` failed: open its run in the Expo dashboard. A changed `eas.json` moves the fingerprint, so no `production` build matches until one is built. |
| `ad …` exits 76 | The command failed twice on the device side (the remote runner, not the app); the lane already retried once. Release, lease again, retry once; then report `unavailable`. |
| The session ended mid-run | The 40-minute cap or the idle cap. `lease` notices the session is gone and starts another; the app is installed fresh, so pair appduct again. |
| `appduct link` says the app did not claim the link | The app is not running, or the "Open in" alert is up: `device-lane.sh ad alert accept`, then link again (a link works once, for 5 minutes). |
| "the link advertises X but the session only reaches Y" | The appduct daemon's address changed after the lease. `release` and lease again, or set `APEX_APPDUCT_ENDPOINT`. |
| An `.ad` script needs the product API and fails | The session cannot reach it. Add its `host:port` to `APEX_EGRESS_ALLOW` before `lease`. |
| `Replacing daemon … version mismatch` | Normal after a version bump; the pinned CLI replaces the old daemon. |
| appduct `ambiguous_session` | Two apps paired: pass the session id or alias (`appduct sessions ls`). |
| appduct version mismatch after an upgrade | `pnpm exec appduct daemon stop` (drops sessions), re-pair. |
| `policy_denied` | The operator policy refuses that tool; use the UI path (tap the banner). |
