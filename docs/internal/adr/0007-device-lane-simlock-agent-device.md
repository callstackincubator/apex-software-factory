# 0007 — Devices are leased with simlock and driven with agent-device; appduct ships in the booth binary

Status: Accepted

## Context

The factory proves mobile Done when lines on a simulator, and at reactCon Berlin it is also
the showcase for Callstack's tools for agentic React Native work. Until now one machine-wide
lock (`sim-lane.sh`) serialised every build and every device step, on whatever simulator was
booted, and its `flow:` step needed Maestro, which the booth laptop does not have. Two tasks
delivered in parallel queued behind each other, a crashed agent could hold the lane, and an
agent could boot, erase or screenshot a simulator another agent was using.

Four tools cover what is missing: simlock (a local daemon that hands out booted, exclusive,
health-checked devices with a queue and a TTL), agent-device (accessibility snapshots, actions,
evidence and `.ad` replay scripts for agents), appduct (tools the running app registers, called
from the host), and Rozenite (React Native DevTools data for agents, through Metro).

## Decision

1. **simlock leases every simulator and emulator** an agent uses. The target is simlock 0.3.0,
   whose devices live in its own device set (`SIMLOCK_IOS_DEVICE_SET`) or behind its own adb
   server (`ANDROID_ADB_SERVER_PORT`), which plain `simctl`, Xcode and other agents cannot
   touch. The maintainer pins it in the workspace once 0.3.0 is published; until then the
   lane runs the CLI named by `SIMLOCK_BIN`. A lane's requester id is `apex:<branch>`, set
   explicitly because OpenCode exports no session id simlock could use. Leases are detached
   with a TTL (60 minutes, renewed by every device call once half has passed) and released
   explicitly on every path; the TTL is only the crash backstop. A lease simlock cannot serve
   within 30 minutes is `busy`.
2. **agent-device does every agent interaction with a device**, always pinned to the lease:
   `--udid` or `--serial`, `--ios-simulator-device-set`, and `--session apex-<branch>`. A spec's
   device-level test is an agent-device replay script (`e2e:`, `apps/mobile/e2e/<name>.ad`); the
   Maestro `flow:` prefix is retired.
3. **The factory reaches devices only through `.agents/scripts/device-lane.sh`**, which wraps
   the four CLIs (lease, build, install, metro, ad, appduct, rozenite, screenshot, status,
   release) and never calls raw `simctl` or `adb`. The `agent-device` and `appduct` MCP servers
   in `opencode.json` serve a person in the interactive `build` agent only; every other agent
   is denied their tools. One MCP process serves all of an OpenCode instance's sessions, so it
   would give parallel lanes one simlock identity and one agent-device session.
4. **Builds hold no lease.** A lane builds for a generic simulator destination and installs
   through agent-device, so a device is leased only while it is used. Native builds wait for
   one of the machine's build slots (one by default), so parallel lanes never run two Xcode
   builds at once unless the maintainer allows it.
5. **appduct ships in the booth binary and in every OTA bundle: one build profile,
   `APPDUCT_ENABLED=1`, everywhere** — the booth binary, the recorded fingerprint, every OTA
   deploy, every lane build. There is no separate QA binary: the Release build a verifier
   installs has the production configuration, so OTA updates can be checked on it, and its
   tools (`app_info`, `open_route`, `ota_check_now`, …) are there too. Because the tools reach
   production phones, they never return secrets or visitors' data, and destructive ones are
   marked `destructiveHint` and denied by the operator's appduct policy for unattended runs.
6. **Rozenite is for debugging only**: debug builds with a Metro started with
   `WITH_ROZENITE=true`, never CI, a Release build or an OTA deploy. The verifier's Release run
   decides pass or fail; a debug run with Rozenite explains a failure.
7. **Who leases.** The `mobile-verifier` (the gate), the `ota-verifier` (after a merge) and the
   `triager` (when only a running app reproduces a bug) lease a device. The `implementer` may
   lease one to check its own UI work before review — every session checks its own work before
   a person sees it — but its check never replaces the verifier's. simlock queues, so these
   lanes run in parallel safely.

## Consequences

- Two tasks can be at the simulator stage at once, up to simlock's capacity; `needs-simulator`
  now means simlock timed out or the machine cannot run the step.
- simlock erases a device when its lease ends: the app is installed on every lease, and iOS asks
  "Open in Apex Factory?" for the first deep link on each one; the lane answers it.
- appduct changes the native fingerprint. A prebuild, fingerprint or deploy without
  `APPDUCT_ENABLED=1` describes a binary no phone has; `hot-updater.config.ts` refuses it.
- agent-device 0.21.20 accepts the device set only per call: `replay` in its private daemon and
  `test` in per-script sessions lose it, so the lane replays each script inside its own session.
  appduct's `sessions link --open ios-sim` cannot see simlock's set either; the lane pairs by
  opening the link with agent-device.
- The device tools are host tools pinned in the workspace (safety rule 2); simlock, the
  agent-device runner cache and the appduct daemon are host setup the maintainer owns.
- Delivery rule 16, testing rule 6, safety rules 2, 9 and 10, the templates' Agent hooks and the
  skills `verify-mobile`, `verify-ota`, `triage-bug`, `implement`, `spec-session` and `deliver`
  follow from this record.
