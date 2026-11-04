# Set up a factory machine

This page sets up the whole factory on a new Mac, from zero: the repository,
OpenCode, the device tools, the OTA stack, the GitHub Actions runners, and the
binary on the booth phones. It ends with moving off the **temporary dev Mac**
(user `aitwar`), where everything runs today. The booth laptop is a different
Mac.

How the factory works: [FACTORY.md](FACTORY.md). The runbooks this page draws
on, with the reasons behind each step, are
[OTA.md](internal/OTA.md), [DEVICES.md](internal/DEVICES.md) and
[DELIVERY.md](internal/DELIVERY.md).

Run every command as the user who will own the factory (the "maintainer's
user"). The runners run as that user, so its logins (GitHub, OpenCode) and its
home directory (`~/.appduct`, `~/.cache/apex-software-factory`, simlock's
state) are the ones every job uses. Never paste a secret into a command line,
an issue or a log; the commands below read secrets from files.

**Order matters when you move machines.** Set up the new Mac through section
8 (its runners registered and started), then stop the temporary Mac's runners
at once. Only then point GitHub at the new Mac (section 9), and remove the
temporary Mac's runners only after the smoke test passes. The full order and
the rollback are in [14.1](#141-the-order).

## Ports

| Port   | What                             | Listens on            |
| ------ | -------------------------------- | --------------------- |
| `3001` | Product API (`apps/api`)         | all interfaces        |
| `8081` | Metro (dev loop)                 | the Mac               |
| `8443` | appduct daemon (TLS WebSocket)   | the app connects here |

Phones must reach `3001` over the booth Wi-Fi. Allow `node` in the macOS
firewall (System Settings → Network → Firewall). Updates come from Expo's
servers, not from this Mac.

## 1. Requirements

- macOS on Apple silicon. The temporary Mac runs macOS 26.5.
- At least 100 GB of free disk: Xcode, simulator runtimes, simlock's
  simulators, native builds and the build cache.
- Xcode with an iOS simulator runtime. The temporary Mac has Xcode 26.6 and
  iOS 26.5. Lanes lease an "iPhone 17 Pro" by default.
- CocoaPods, for iOS builds (`pod install`).
- Node 22.18 or newer, and pnpm through corepack. `package.json` pins the
  pnpm version (`packageManager`).
- The GitHub CLI (`gh`), logged in with write access to
  `callstackincubator/apex-software-factory`.
- OpenCode v2. The temporary Mac runs v2.0.22.
- Optional, for Android: the Android SDK at `~/Library/Android/sdk`, an AVD
  (`Pixel_8` on the temporary Mac) and JDK 17 (Zulu 17).
- A Wi-Fi router you control, with a DHCP reservation for the Mac. Venue Wi-Fi
  often blocks traffic between clients, which silently breaks phone → Mac.

Check what is there:

```bash
sw_vers && uname -m
```

```bash
df -h ~
```

```bash
xcodebuild -version && xcrun simctl list runtimes
```

```bash
pod --version
```

```bash
node --version
```

```bash
gh auth status
```

```bash
opencode --version
```

`sqlite3` and `python3` must also be on the `PATH`. macOS ships `sqlite3`;
`python3` comes with Xcode's command line tools. `factory-run.sh` needs
`sqlite3`, and `worktree.sh` uses `python3` for fast `node_modules` clones.

## 2. Install the missing tools

Install Node 22 where the runners will find it.
[`scripts/ci/runner-env.sh`](../scripts/ci/runner-env.sh) looks, in order, in
`APEX_NODE_BIN`, the `PATH`, fnm's **default alias**, Volta, Homebrew
(`/opt/homebrew/opt/node@22/bin`, `/opt/homebrew/bin`) and `/usr/local/bin`.
Homebrew is the simplest:

```bash
brew install node@22 gh cocoapods
```

If you use fnm instead, set a default (`fnm default 22`): the runner cannot use
fnm's per-shell directories.

Turn on corepack, so `pnpm` follows the repository's pin:

```bash
corepack enable
```

Log in to GitHub. You need this login for the setup below. Agents in a
person's own session (the console, the `build` agent) also act through it.
Unattended runs act as the factory's GitHub App instead
([section 9](#9-point-github-at-this-mac)), except for uploading the
simulator's screenshots and videos to a PR comment: GitHub accepts those
uploads only from a user's token. Without this login the PR gets text
evidence only:

```bash
gh auth login
```

Install Xcode from its vendor, then open Xcode once to
accept the license and install a simulator runtime.

Install OpenCode v2 from [opencode.ai](https://opencode.ai). The factory
workflow looks for `opencode` in `~/.opencode/bin` and `/opt/homebrew/bin`,
so install it into one of those.

> Not verified from the repository: the exact installer command for OpenCode
> v2, and the Homebrew formulas. The temporary Mac has CocoaPods as a Homebrew
> Ruby gem, Node 22.22.2 and OpenCode at `~/.opencode/bin/opencode`.

## 3. Clone and check

Keep the main checkout at `~/Projects/apex-software-factory`. The OTA stack's
state lives in it, so it survives agent worktree cleanup.

```bash
gh repo clone callstackincubator/apex-software-factory ~/Projects/apex-software-factory
```

```bash
cd ~/Projects/apex-software-factory
```

```bash
pnpm install
```

```bash
pnpm check
```

`pnpm install` installs everything the factory runs, including agent-device,
appduct and Rozenite; nothing is installed globally. It also installs the
lefthook git hooks.

## 4. OpenCode

The repository's [`opencode.json`](../opencode.json) carries the whole
`callstack.ai` provider definition: base URL, limits, reasoning variants, and
the setting that keeps the model's reasoning between steps. The machine needs
only the login. No global provider config is needed; if one exists, the
repository's settings merge over it.

```bash
opencode auth login
```

Choose the `callstack.ai` provider. The login lands in
`~/.local/share/opencode/auth.json`, which the runners use because they run as
the same user.

Then check that no agent can reach a permission prompt (it needs the login,
and a checkout that is not nested inside another one):

```bash
.agents/scripts/check-agent-permissions.sh
```

It exits 0 when no agent can reach "ask".

## 5. Device tools

All device work goes through
[`.agents/scripts/device-lane.sh`](../.agents/scripts/device-lane.sh). Run
these from the main checkout.

### agent-device

Pinned in the root `package.json`, installed by `pnpm install`.

```bash
export AGENT_DEVICE_NO_UPDATE_NOTIFIER=1
```

```bash
pnpm exec agent-device doctor --platform ios
```

It must end with `Doctor: pass`. It also starts building agent-device's iOS
runner in the background (several minutes, once per Xcode version). A global
`agent-device` on the `PATH` is older; ignore it.

### appduct

Pinned in the root `package.json` (CLI) and in `apps/mobile` (the app side).
Its daemon starts on the first `appduct` command, keeps its key and logs in
`~/.appduct/`, and listens on port `8443` for the app.

```bash
pnpm exec appduct --version
```

Create the operator policy for unattended runs. It denies tools marked
destructive (today `reload_app`), and keeps a pairing alive through Wi-Fi drops
for an hour:

```bash
mkdir -p ~/.appduct && printf '%s\n' '{ "policy": { "default": "allow", "destructive": "deny" }, "graceSeconds": 3600 }' > ~/.appduct/config.json
```

The daemon reads this file only when it starts:

```bash
pnpm exec appduct daemon stop
```

> `graceSeconds` placement follows [OTA.md](internal/OTA.md#booth-phones-appduct-pairing)
> ("next to the policy"); the temporary Mac's file has only the policy.

### simlock

simlock leases the simulators. `device-lane.sh` and `prewarm.sh` find it this
way: `pnpm exec simlock` when the workspace has it
(`node_modules/.bin/simlock`), otherwise the command line in `SIMLOCK_BIN`.
Without either, simulator checks report `unavailable`. `SIMLOCK_HOME` moves
simlock's state and devices; keep the path short, because it holds sockets.
simlock's daemon starts on demand.

**Once `simlock@0.3.0` is on npm** (today npm has only 0.2.0), a maintainer
pins it in the workspace and commits the change:

```bash
pnpm add -D -w simlock@0.3.0
```

Then `pnpm install` brings it, `pnpm exec simlock` wins, and `SIMLOCK_BIN` can
go. Keep `SIMLOCK_HOME`.

**Until then**, build simlock 0.3.0 from source and point `SIMLOCK_BIN` at it:

```bash
gh repo clone callstackincubator/simlock ~/Projects/simlock
```

```bash
cd ~/Projects/simlock && pnpm install && pnpm build
```

Add both variables to your shell profile, for `prewarm.sh` and for people
using the `build` agent:

```bash
printf '%s\n' "export SIMLOCK_BIN=\"node $HOME/Projects/simlock/dist/cli/main.js\"" 'export SIMLOCK_HOME=/tmp/apex-slk' >> ~/.zshrc
```

Open a new terminal, then, from the main checkout:

```bash
.agents/scripts/device-lane.sh status
```

The factory runners get the same two variables from their `.env` files
([section 8](#8-self-hosted-runners)).

> `/tmp/apex-slk` is what the temporary Mac uses. macOS clears `/tmp` on a
> restart, so simlock then starts with no simulators and creates them again
> (`prewarm.sh` does it). A short path outside `/tmp` would survive restarts;
> that has not been tried.

### Rozenite

Nothing to install: it is an `apps/mobile` devDependency. It works only in
debug builds, with Metro started with `WITH_ROZENITE=true`
(`pnpm --filter @apex/mobile start:agent`, or `device-lane.sh metro start` in a
lane). It is never in a Release build or an OTA bundle.

### Android (optional)

Set these in the shell (and in the factory runners' `.env` if lanes should
build for Android):

```bash
export ANDROID_HOME=$HOME/Library/Android/sdk
```

```bash
export JAVA_HOME=/Library/Java/JavaVirtualMachines/zulu-17.jdk/Contents/Home
```

Put `$ANDROID_HOME/platform-tools` and `$ANDROID_HOME/emulator` on the `PATH`.

## 6. The OTA path

Updates are published to EAS Update from GitHub Actions
(`ota-publish.yml`, on GitHub's own runners), and binaries are built on EAS:
nothing for the OTA path runs on this Mac. What a maintainer needs:

- `eas-cli` logged in to the `callstack.io` Expo account (`eas whoami`), for
  building binaries and for the rollback commands.
- The repository secret `EXPO_TOKEN` (section 9).
- The EAS channels and environments from
  [OTA.md, One-time setup](internal/OTA.md#one-time-setup).

## 7. The product API

The app reads `apps/api` on port `3001` for its status footer and for any
feature that crosses the wire. Run it from the main checkout, in its own tab:

```bash
pnpm --filter @apex/api start
```

> Not covered by the repository: no workflow restarts the API after a merge
> that changes `apps/api`, and no launchd job keeps it running. Restart it by
> hand (Ctrl-C, `git pull`, start) after such a merge. The app works without
> the API; the footer then says "offline".

## 8. Self-hosted runners

Two runners, both on this Mac, both as the maintainer's user, both launchd
services. Workflows pick runners by label only. Each Mac names its runners
after its own host name, so two Macs never collide and the old one can stay
registered until the new one is proven.

| Directory                    | Name                       | Label     | Runs              |
| ---------------------------- | -------------------------- | --------- | ----------------- |
| `~/actions-runner-factory-1` | `<host name>-factory-1`    | `factory` | `factory.yml`     |
| `~/actions-runner-factory-2` | `<host name>-factory-2`    | `factory` | `factory.yml`     |

GitHub adds the labels `self-hosted`, `macOS` and `ARM64` by itself. The
temporary Mac's runners are named `booth-factory-1` and
`booth-factory-2`.

**Download the runner.** Find the current macOS ARM64 package:

```bash
gh api repos/actions/runner/releases/latest -q '.assets[] | select(.name | test("osx-arm64.*tar.gz$")) | .browser_download_url'
```

Then unpack it into each of the two directories (replace `<url>` with the
printed URL):

```bash
for d in ~/actions-runner-factory-1 ~/actions-runner-factory-2; do mkdir -p "$d" && curl -fsSL "<url>" | tar xz -C "$d"; done
```

**Register each runner.** Run `config.sh` from a normal login shell where
`node`, `gh` and `opencode` are on the `PATH`: the runner keeps a snapshot of
that `PATH` in its `.path` file. A registration token lasts an hour; get a
fresh one per runner. Keep the same terminal for both, so the name prefix
is set:

```bash
name_prefix=$(scutil --get LocalHostName)
```

The two factory runners:

```bash
cd ~/actions-runner-factory-1
```

```bash
./config.sh --unattended --url https://github.com/callstackincubator/apex-software-factory --name "${name_prefix}-factory-1" --labels factory --token "$(gh api -X POST repos/callstackincubator/apex-software-factory/actions/runners/registration-token -q .token)"
```

```bash
cd ~/actions-runner-factory-2
```

```bash
./config.sh --unattended --url https://github.com/callstackincubator/apex-software-factory --name "${name_prefix}-factory-2" --labels factory --token "$(gh api -X POST repos/callstackincubator/apex-software-factory/actions/runners/registration-token -q .token)"
```

**Give the factory runners simlock.** Each runner's `.env` holds `KEY=value`
lines it passes to every job. The factory runners need `SIMLOCK_BIN` and
`SIMLOCK_HOME`, the same values as your shell. `SIMLOCK_HOME` must be the one
the running simlock daemon uses.

```bash
printf 'SIMLOCK_BIN=node %s/Projects/simlock/dist/cli/main.js\nSIMLOCK_HOME=/tmp/apex-slk\n' "$HOME" >> ~/actions-runner-factory-1/.env
```

```bash
printf 'SIMLOCK_BIN=node %s/Projects/simlock/dist/cli/main.js\nSIMLOCK_HOME=/tmp/apex-slk\n' "$HOME" >> ~/actions-runner-factory-2/.env
```

Once simlock is a workspace dependency, drop `SIMLOCK_BIN` and keep
`SIMLOCK_HOME`.

Node, pnpm and `gh` need nothing in `.env`: `scripts/ci/runner-env.sh` finds
them on every job (see section 2). To force a Node, add
`APEX_NODE_BIN=<directory containing node>` to the runner's `.env`.

**Install and start the services**, in each of the two directories:

```bash
cd ~/actions-runner-factory-1 && ./svc.sh install && ./svc.sh start
```

```bash
cd ~/actions-runner-factory-2 && ./svc.sh install && ./svc.sh start
```

After any change to a runner's `.env`, restart its service
(`./svc.sh stop && ./svc.sh start` in its directory).

**Check them.** Both must be `online`:

```bash
gh api repos/callstackincubator/apex-software-factory/actions/runners -q '.runners[] | "\(.name) \(.status) \([.labels[].name] | join(","))"'
```

> If another Mac's runners are still online (the temporary Mac), a job can now
> land on either Mac. Stop the other Mac's runners straight away
> ([14.2](#142-stop-the-old-runners)), before anything else.

What each runner needs, and why: [DELIVERY.md, The
factory dispatcher](internal/DELIVERY.md#the-factory-dispatcher).

## 9. Point GitHub at this Mac

> Do this only when no other Mac's runners are online
> ([14.2](#142-stop-the-old-runners)). The values below change what the
> booth binaries talk to.

Find the Mac's LAN IP (Wi-Fi is `en0` on most Macs; try `en1` if it is empty):

```bash
ipconfig getifaddr en0
```

Give this IP a DHCP reservation on the booth router. **The IP is compiled into
the product API address of the booth binary and of every OTA bundle**: a new IP
means new EAS environment values and new binaries
([section 11](#11-the-booth-binary)).

Set the API address in the EAS `production` and `preview` environments, so
builds and updates carry it (it uses the LAN IP):

```bash
LAN_IP=$(ipconfig getifaddr en0)
```

```bash
(cd apps/mobile && eas env:set production --name EXPO_PUBLIC_API_URL --value "http://$LAN_IP:3001" --visibility plaintext --non-interactive && eas env:set preview --name EXPO_PUBLIC_API_URL --value "http://$LAN_IP:3001" --visibility plaintext --non-interactive)
```

Set the Expo token as a secret (create it in the `callstack.io` account's
access token settings). `gh secret set NAME` reads the value from standard
input, so it never appears in the terminal or the shell history:

```bash
gh secret set EXPO_TOKEN
```

Unattended runs act on GitHub as the factory's GitHub App (ADR 0020). It
belongs to the repository, not to a Mac, so a switchover changes nothing here.
Check that both of its secrets are listed below: `FACTORY_APP_ID` and
`FACTORY_APP_PRIVATE_KEY`. If they are missing, an organization owner creates
the app:

- No webhook.
- Repository permissions: Contents, Issues and Pull requests read and write;
  Actions, Checks and Commit statuses read. Metadata is always read.
- Not Workflows: an unattended run must not change `.github/workflows/`
  (safety rule 6).
- Installed on this repository only.

Then store its ID and a private key it generated:

```bash
printf '%s' "<app id>" | gh secret set FACTORY_APP_ID
```

```bash
gh secret set FACTORY_APP_PRIVATE_KEY < "<path to the downloaded .pem>"
```

Delete the downloaded `.pem` afterwards. The runners never need it: each
factory job mints a one-hour token from the secrets.

Check the names (values are never shown):

```bash
gh variable list && gh secret list
```

Then run the OTA publish in preflight mode. It prints the fingerprints, looks
for their `production` builds on EAS, and publishes nothing:

```bash
gh workflow run ota-publish.yml -f preflight_only=true
```

```bash
gh run watch "$(gh run list --workflow ota-publish.yml --limit 1 --json databaseId -q '.[0].databaseId')"
```

## 10. Every morning

From the main checkout, in this order:

1. Start the product API ([section 7](#7-the-product-api)).
2. Warm the machine: the pnpm store, the native build cache for the current
   fingerprint, simlock's simulators and agent-device's runner on each. It
   needs `SIMLOCK_BIN` and `SIMLOCK_HOME` in the shell. A cold run compiles
   one Release build (several minutes); later runs take seconds.

   ```bash
   .agents/scripts/prewarm.sh
   ```

   Options: `--devices <n>` (default 2, one per factory runner), `--android`,
   `--debug`, `--metro`.

3. Pair each booth phone with appduct (booth Wi-Fi, app running). Scan the QR
   code with the phone's camera; the link works once, for 5 minutes:

   ```bash
   .agents/scripts/prewarm.sh --pair-phone
   ```

   Check the pairings (from `apps/mobile`): `pnpm exec appduct sessions ls`.
   A pairing ends when the app process dies or the daemon restarts; pair again
   then.

## 11. The booth binary

The booth binaries run a **Release** build on the `production` channel:
expo-updates does not run in a debug build. EAS builds one binary per native
fingerprint and platform (`eas build --profile production`). Detail:
[OTA.md, Production builds](internal/OTA.md#production-builds)
and [apps/mobile/README.md](../apps/mobile/README.md#release-builds-and-over-the-air-updates).

Every build of it must have:

- `APPDUCT_ENABLED=1`. It links appduct and changes the iOS fingerprint;
  every `eas.json` profile sets it.
- `EXPO_PUBLIC_API_URL` set to the EAS environment value from section 9 (EAS
  supplies it to builds and updates). Every OTA bundle replaces the binary's
  JavaScript with its own inlined values.
- A `main` checkout. The binary's runtime version is the fingerprint of the
  commit it was built from; a bundle reaches it only when the fingerprints
  match.

Set the build environment once per terminal:

```bash
LAN_IP=$(ipconfig getifaddr en0)
```

```bash
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 APPDUCT_ENABLED=1 EXPO_PUBLIC_API_URL=http://$LAN_IP:3001
```

**iPhone.** Connect the phone by USB, then from `apps/mobile` build and
install the Release configuration. `--device` with no value lets you pick the
phone:

```bash
(cd apps/mobile && pnpm exec expo run:ios --configuration Release --no-bundler --device)
```

> Not verified: no real iPhone has been built for yet. A device build needs an
> Apple signing team and the phone registered with it. Do **not** add
> `ios.appleTeamId` to `app.json` for this: `app.json` is part of the
> fingerprint, so that edit is a native change. Pick the team when Expo asks,
> or in Xcode on the generated `ios/` project (generated files do not change
> the fingerprint).

**Android.** Add `GOOGLE_MAPS_ANDROID_API_KEY=<key>` to
the environment if maps should show tiles; without it the map is an empty
grid. Never commit the key.

```bash
(cd apps/mobile && pnpm exec expo prebuild --platform android --no-install)
```

```bash
(cd apps/mobile/android && ./gradlew assembleRelease)
```

```bash
adb install -r apps/mobile/android/app/build/outputs/apk/release/app-release.apk
```

The APK is signed with the debug keystore Expo generates: fine for the booth,
not for a store. A first Android build takes about 8 minutes.

**Check it.** On each phone, accept the "find devices on your local network"
prompt (iOS), and confirm the footer's **Bundle** row reads
`embedded · production`. Check that appduct is linked in a built app:

```bash
(cd apps/mobile && pnpm exec appduct doctor android/app/build/outputs/apk/release/app-release.apk --assert-present)
```

Simulator builds for the agents come from `device-lane.sh` and the build cache;
you do not build those by hand.

## 12. Check the model keeps its reasoning

The model's endpoint reads earlier reasoning only from the `reasoning` field.
`opencode.json` sets `"compatibility": { "reasoningField": "reasoning" }` so
OpenCode sends it there. If the endpoint or OpenCode changes, each step would
plan from scratch again and runs get slow. Check it on a new machine, after an
OpenCode upgrade, and when runs suddenly take much longer.

When reasoning is kept, a step's prompt (`tokens.input + tokens.cache.read`)
is larger than the previous step's by at least that step's reasoning
(`tokens.reasoning`). When it is dropped, the prompt grows only by the output
and tool results.

Run any session with a few steps first, for example a short factory run, or:

```bash
opencode run "Read AGENTS.md, then read two of the skills it lists, and say in one sentence what each does."
```

Then list the newest session with at least five steps:

```bash
set -o pipefail
sqlite3 -json -readonly ~/.local/share/opencode/opencode.db "
  select json_extract(data, '$.tokens.input') + json_extract(data, '$.tokens.cache.read') as prompt,
         json_extract(data, '$.tokens.reasoning') as reasoning
  from session_message
  where type = 'assistant'
    and session_id = (select session_id from session_message where type = 'assistant'
                      group by session_id having count(*) >= 5
                      order by max(time_created) desc limit 1)
  order by seq" |
  node -e '
    const rows = JSON.parse(require("fs").readFileSync(0, "utf8") || "[]");
    for (let i = 1; i < rows.length; i++) {
      const grew = rows[i].prompt - rows[i - 1].prompt;
      const thought = rows[i - 1].reasoning;
      let verdict = "";
      if (grew < 0) verdict = "(prompt shrank: compaction, skip)";
      else if (thought >= 500) verdict = grew >= 0.8 * thought ? "kept" : "DROPPED";
      console.log(`step ${i + 1}: prompt +${grew}, step ${i} reasoned ${thought} ${verdict}`);
    }'
```

Only steps after one that reasoned 500 tokens or more get a verdict. Output
from a healthy session on the temporary Mac:

```
step 10: prompt +3625, step 9 reasoned 2722 kept
step 11: prompt +1722, step 10 reasoned 1409 kept
```

Mostly `kept`: fine. Mostly `DROPPED`: the endpoint ignores the field. Read
[ADR 0014](internal/adr/0014-keep-the-models-reasoning-between-steps.md) and
update the setting in `opencode.json`.

## 13. Smoke test

Prove the whole line on this Mac: a label starts a run on a `factory` runner,
the run merges, the OTA publish ships, a phone shows the banner.

1. Write a tiny one-PR feature from
   [the booth feature template](internal/templates/booth-feature.md). Pick
   something you are happy to keep on the phones, for example a
   "Shipped at the booth" entry. Save the body to a file, then file it:

   ```bash
   gh issue create --title "<short title>" --label feature:spec --body-file <file>
   ```

   Or let the tools write it: `/spec <n> technical` in OpenCode ends with the
   spec checker.

2. Sign it. This starts the run:

   ```bash
   gh issue edit <n> --add-label feature:ready
   ```

3. Watch it ([FACTORY.md, You want to watch a run](FACTORY.md#you-want-to-watch-a-run)):

   ```bash
   gh run list --workflow factory.yml --limit 3
   ```

4. After the merge, watch the publish, then the phone. The banner "New feature
   landed — tap to reload" should show within about 30 seconds (at once on a
   paired phone):

   ```bash
   gh run list --workflow ota-publish.yml --limit 3
   ```

The run ends with a `## Delivery run` comment on the issue, posted by the
factory app's bot (`<app slug>[bot]`), which also authored the PR and its
commits. A parked run leaves a `## Handoff` comment instead; see
[FACTORY.md, What to do when…](FACTORY.md#what-to-do-when).

To take a test feature off the phones, a maintainer disables its bundle
([OTA.md, Rollback](internal/OTA.md#rollback)) and reverts the PR.

## 14. Move off the temporary Mac

The temporary Mac (user `aitwar`) was set up before ADR 0025: besides the two
factory runners of [section 8](#8-self-hosted-runners) it still has the `ota`
runner in `~/actions-runner`, and MinIO and the OTA server running from
`/Users/aitwar/Projects/apex-software-factory`,
simlock with `SIMLOCK_HOME=/tmp/apex-slk`, and the native build cache. The
repository variables point at its LAN IP, `192.168.1.61`.

### 14.1 The order

1. **Set up the new Mac fully**: sections 1–8. Its runners are registered and
   their services started, the OTA stack is up, and the repository variables
   still point at the old IP.
2. **Stop the old Mac's runners** ([14.2](#142-stop-the-old-runners)), right
   after step 1. Do not uninstall or deregister them yet. Two Macs online with
   the same labels could run a factory job on the old Mac.
3. **Switch and prove the new Mac**: point GitHub at it
   ([section 9](#9-point-github-at-this-mac)), build and install the booth
   binary ([section 11](#11-the-booth-binary)), run the smoke test
   ([section 13](#13-smoke-test)).
4. **Only after the smoke test passes**, remove the old runners
   ([14.3](#143-remove-the-old-runners)) and clean up the old Mac
   ([14.4](#144-clean-up-the-temporary-mac)).

**Rollback, before step 4:** stop the new Mac's three runner services
(`./svc.sh stop` in each directory), start the old Mac's again
(`./svc.sh start`), and set the repository variables and secrets back to the
old Mac's values. The old values are still in its env files.

### 14.2 Stop the old runners

First make sure no run is in progress on the old Mac:

```bash
gh run list --workflow factory.yml --limit 5
```

```bash
gh run list --workflow ota-publish.yml --limit 3
```

Then, on the temporary Mac, stop the three services. This is reversible
(`./svc.sh start` brings each back):

```bash
cd ~/actions-runner && ./svc.sh stop
```

```bash
cd ~/actions-runner-factory-1 && ./svc.sh stop
```

```bash
cd ~/actions-runner-factory-2 && ./svc.sh stop
```

Check that only the new Mac's runners are `online`:

```bash
gh api repos/callstackincubator/apex-software-factory/actions/runners -q '.runners[] | "\(.name) \(.status)"'
```

### 14.3 Remove the old runners

Only after the smoke test passed on the new Mac. On the temporary Mac,
uninstall each service, then remove its registration with a removal token
(a token lasts an hour; get a fresh one per runner):

```bash
cd ~/actions-runner && ./svc.sh uninstall && ./config.sh remove --token "$(gh api -X POST repos/callstackincubator/apex-software-factory/actions/runners/remove-token -q .token)"
```

```bash
cd ~/actions-runner-factory-1 && ./svc.sh uninstall && ./config.sh remove --token "$(gh api -X POST repos/callstackincubator/apex-software-factory/actions/runners/remove-token -q .token)"
```

```bash
cd ~/actions-runner-factory-2 && ./svc.sh uninstall && ./config.sh remove --token "$(gh api -X POST repos/callstackincubator/apex-software-factory/actions/runners/remove-token -q .token)"
```

Check that only the new Mac's runners are left:

```bash
gh api repos/callstackincubator/apex-software-factory/actions/runners -q '.runners[] | "\(.name) \(.status)"'
```

Then delete the three runner directories:

```bash
rm -rf ~/actions-runner ~/actions-runner-factory-1 ~/actions-runner-factory-2
```

### 14.4 Clean up the temporary Mac

On the temporary Mac, from `/Users/aitwar/Projects/apex-software-factory`.

Stop the OTA server (a host process; SIGTERM drains it), and the API if it
runs. Find the process on each port, then `kill <pid>`:

```bash
lsof -nP -iTCP:3002 -sTCP:LISTEN
```

```bash
lsof -nP -iTCP:3001 -sTCP:LISTEN
```

On the old Mac only, in a checkout from before ADR 0025 (the new setup has no
MinIO): stop and remove the MinIO containers:

```bash
docker compose -f infra/docker-compose.yml down
```

Delete the env files, which hold the old OTA token and S3 credentials. They
may exist in the main checkout and in worktrees:

```bash
rm -f infra/.env apps/ota-server/.env apps/mobile/.env.hotupdater
```

```bash
find . -name node_modules -prune -o \( -name .env -o -name .env.hotupdater \) -print
```

Delete the OTA data (bundles in MinIO and the bundle database):

```bash
rm -rf infra/data apps/ota-server/data
```

Release simlock's leases, delete its devices and stop its daemon. These are
operator commands, for a person only:

```bash
SIMLOCK_HOME=/tmp/apex-slk node ~/Projects/simlock/dist/cli/main.js status
```

```bash
SIMLOCK_HOME=/tmp/apex-slk node ~/Projects/simlock/dist/cli/main.js nuke --yes --delete-devices
```

```bash
SIMLOCK_HOME=/tmp/apex-slk node ~/Projects/simlock/dist/cli/main.js daemon stop
```

```bash
rm -rf /tmp/apex-slk
```

Delete the native build cache (it also holds the pinned pnpm):

```bash
rm -rf ~/.cache/apex-software-factory
```

Stop the device tools' daemons, and delete appduct's key and logs (from the
main checkout):

```bash
pnpm exec appduct daemon stop && pnpm exec agent-device daemon stop
```

```bash
rm -rf ~/.appduct ~/.agent-device
```

### 14.5 Log out

If the Mac goes back to someone else, remove the maintainer's logins:

```bash
gh auth logout
```

```bash
rm -f ~/.local/share/opencode/auth.json
```

Remove the `SIMLOCK_BIN` and `SIMLOCK_HOME` lines from `~/.zshrc` if you added
them there.

The repository variables already point at the new Mac (section 9). Check them
one last time:

```bash
gh variable list
```

## What this page could not verify

- The OpenCode v2 installer and the Homebrew formulas (section 2): taken from
  the temporary Mac's state, not from the repository.
- Building for and installing on a real iPhone, and the signing step
  (section 11).
- Whether `/tmp/apex-slk` survives a restart, and simlock after it
  (section 5).
- `graceSeconds` in `~/.appduct/config.json` (section 5): documented in
  OTA.md, not set on the temporary Mac.
- Keeping the product API up to date after merges (section 7): nothing in the
  repository does it.
- `simlock nuke --yes --delete-devices` and `daemon stop` (section 14.4): from
  simlock's README and the factory's deny list, not run on the temporary Mac.
