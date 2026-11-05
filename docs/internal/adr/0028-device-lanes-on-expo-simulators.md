# 0028 — Device lanes are Expo Simulators sessions on EAS

Status: Accepted

Supersedes [0007](0007-device-lane-simlock-agent-device.md).

## Context

ADR 0007 leased simulators from simlock on the booth laptop, built native code there and
installed it through agent-device. ADR 0025 moved OTA to EAS Update and ADR 0027 moved lane
binaries to EAS, repacked from the `production` build of the same fingerprint. That leaves the
devices themselves: with the factory on GitHub-hosted ubuntu runners there is no Xcode, no
simulator pool and no Android emulator to lease.

Expo Simulators runs a remote iOS or Android simulator session with the build installed, and
exposes an agent-device daemon for it. A session reaches the network only through an egress
tunnel to the machine that started it, restricted to an allow-list of `host:port` entries.

## Decision

1. **A device is an Expo Simulators session** started with
   `eas simulator:start --type agent-device --build-id <id>`, named `apex-<branch>` and tagged
   `apex`, with a duration cap (60 minutes) and an idle cap (15 minutes) as the backstop when an
   agent dies without releasing it. `eas simulator:stop` ends it.
2. **The build is a build id.** By default it is the lane binary of the checkout
   (`lane-binary.sh`, ADR 0027), built by the first `lease` when none exists for HEAD.
   `lease --production` takes the finished `production` build with the checkout's native
   fingerprint instead: the OTA check needs a binary on the `production` channel, which a lane
   binary is not. `lease --build-id <id>` takes any build.
3. **agent-device is reached through the session's daemon.** `device-lane.sh` exports
   `AGENT_DEVICE_DAEMON_BASE_URL` and `AGENT_DEVICE_DAEMON_AUTH_TOKEN` from
   `apps/mobile/.env.eas-simulator`, which `simulator:start` writes and `release` deletes, plus
   `AGENT_DEVICE_SESSION=apex-<branch>`. The file is a secret: it is never printed and stays
   gitignored.
4. **Egress is local and allow-listed.** `lease` starts `eas simulator:egress` in the
   background and `release` kills it. The allow-list is the appduct daemon's advertised
   address and wss port (read from a link `lease` mints and revokes, or
   `APEX_APPDUCT_ENDPOINT`), plus `APEX_EGRESS_ALLOW` for anything else a check needs, such as
   the product API. appduct itself stays in every binary (ADR 0007, item 5).
5. **Metro, debug builds and Rozenite are gone.** A lane binary is a Release build that loads
   no JavaScript from a dev server, and the session cannot reach one. The `build ... debug`,
   `install`, `metro`, `rozenite` and `renew` (now informational) subcommands lose their
   function; failures are explained from agent-device snapshots and appduct events.
6. **Agents reach devices only through `.agents/scripts/device-lane.sh`.** `opencode.json`
   denies `eas simulator` and `eas-cli simulator` in bash, next to the denies of ADR 0025, and
   no longer declares a simlock MCP server or permissions.
7. **The native build cache is deleted.** `tools/expo-build-cache/` and `buildCacheProvider`
   in `app.json` go, as ADR 0027 said they would.

## Consequences

- No device pool, no build slots and no Xcode on the factory runners. A session costs EAS
  minutes, so the caps matter and `release` always runs.
- A lane needs `EXPO_TOKEN` (or a signed-in `eas`) and a reachable appduct daemon; `device-lane.sh`
  exits 69 when EAS refuses to start one and 75 on a capacity or concurrency refusal.
- The first `lease` of a commit waits for the lane binary: minutes for a repack, up to fifteen
  for a full build. It exits 2 while waiting, as it did while queued.
- Expo Simulators sessions are remote, so `ad replay` and `ad test` run through the daemon;
  scripts that need the host's network (`api-latency.ad` needs the product API) need that
  endpoint in `APEX_EGRESS_ALLOW`.
- Open: a lane binary embeds the JavaScript of the `production` build it was repacked from and
  nothing publishes to the `lane` channel (ADR 0027), so how the PR's own JavaScript reaches
  the session is not settled by this record.
- Delivery rule 16, safety rule 2, `docs/internal/DEVICES.md`, `BOOTSTRAP.md`, `prewarm.sh`
  and the factory workflow still describe the simlock lane and follow in later changes.
