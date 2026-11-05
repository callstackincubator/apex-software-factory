# OTA runbook (EAS Update)

How a merge to `main` reaches the booth binaries, and how to build, check and
recover the pieces. Decision record:
[ADR 0025](adr/0025-ota-through-eas-update.md).

## What runs where

| Piece | Runs on | State |
| --- | --- | --- |
| `expo-updates` in the app | the booth binary | the downloaded update, on the device |
| EAS Update | Expo's servers (project `842cfd94-ab8c-4161-b09a-af1ed785dec8`, account `callstack.io`) | channels, branches, update groups |
| EAS Build | Expo's servers | `production` and `lane` simulator builds and APKs |
| `ota-publish.yml` | GitHub-hosted `ubuntu-24.04` | none |

Flow: a merge to `main` starts `ota-publish.yml`. For iOS and Android it
computes the fingerprint of the merged commit, looks for a finished
`production` EAS build with that fingerprint and, when both exist, runs
`eas update --channel production --environment production`. A binary on the
`production` channel with that runtime version checks (on start, on
foreground, every 30 s), downloads the update, shows the banner, and applies
it when the visitor taps.

## One-time setup

- **`EXPO_TOKEN`**: an access token of the `callstack.io` account, as a
  repository secret. `expo-github-action` exports it to `eas`.
- **EAS environments**: `EXPO_PUBLIC_API_URL` and any other public value the
  bundle needs live in the `production` environment (used by the `production`
  build profile and `eas update --environment production`) and the `preview`
  environment (the `lane` profile): `eas env:set production --name
  EXPO_PUBLIC_API_URL --value <url> --visibility plaintext`. Bundles and
  binaries must see the same values, because an update replaces the binary's
  JavaScript with its inlined `EXPO_PUBLIC_*` values.
- **Channels**: `eas channel:create production` and `eas channel:create lane`.
  A published update goes to the branch its channel points at; `production`
  must point at a branch that receives the publishes. Nothing is ever
  published to `lane`.

## Production builds

Binaries are built on EAS from [`apps/mobile/eas.json`](../../apps/mobile/eas.json),
by a maintainer:

```sh
cd apps/mobile
eas build --profile production --platform all --non-interactive
```

| Profile | Channel | Environment | iOS | Android |
| --- | --- | --- | --- | --- |
| `production` | `production` | `production` | simulator, Release | APK |
| `lane` | `lane` | `preview` | simulator, Release | APK |

Every profile sets `APPDUCT_ENABLED=1`. The Android APK is built
`withoutCredentials`: Expo's generated Gradle project signs release builds
with the debug keystore, which is enough to install it on an emulator.

`production` and `lane` have the same fingerprint (both hash the same
`eas.json`), so a `lane` binary never needs its own native build: the EAS `repack`
job replaces its JS with a PR's bundle. A `lane` binary reads updates only from
the `lane` channel, where nothing is published, so it never adopts a
production update.

### Fingerprints: how an update finds its binary

`runtimeVersion` is `{ "policy": "fingerprint" }`: the binary's runtime version
is the `@expo/fingerprint` hash of the project at build time, and an update is
only offered to binaries with the same runtime version and channel.
[`apps/mobile/fingerprint.config.js`](../../apps/mobile/fingerprint.config.js)
adds the local config plugins as a hash source and ignores
`react-native-maps/ios/AirMaps/RNMapsDefines.h`, which a native build rewrites
inside `node_modules`.

Print them (the profile supplies `APPDUCT_ENABLED=1`, which changes the iOS
hash):

```sh
cd apps/mobile
eas fingerprint:generate --platform ios --build-profile production --json --non-interactive
```

A change to native code, to a native dependency, to `app.json`, to a config
plugin or to `eas.json` (it is a hash source: any edit moves the hash) changes
it. Nothing bypasses the check: no update is published
for a fingerprint without a finished `production` build, and no one publishes
by hand.

## Publishing

`.github/workflows/ota-publish.yml` (see
[DELIVERY.md](DELIVERY.md#ci-and-ota-publishing)) is the only publisher. Its
job summary lists each platform's fingerprint and whether a `production` build
was found. Dispatching it with `preflight_only` does the same lookup and
publishes nothing.

When a platform has no build, the run fails with "Needs a native build",
labels the merged PR `needs-native-build` and comments on it. Binaries keep the
last update until a maintainer builds with `eas build --profile production`;
the next merge that touches the bundle then publishes.

## Booth phones: appduct pairing

appduct pairing lets an agent or a person drive an app on a device through the
laptop's appduct daemon. The publish job no longer nudges paired phones: a
binary checks for itself, and an agent asks it to check now with the
`ota_check_now` tool.

Pair a phone (from the main checkout, booth Wi-Fi, app running):

```sh
.agents/scripts/prewarm.sh --pair-phone     # or: cd apps/mobile && pnpm exec appduct sessions link --qr
```

Scan the QR code with the phone's camera; the app opens and claims the
session (the link works once, for 5 minutes). `pnpm exec appduct sessions ls`
(from `apps/mobile`) lists it as `active`. The booth binary trusts the pin in
the link and only connects to private LAN addresses, so the laptop and the
phone must be on the booth router.

A pairing survives JS reloads — including applying an update — and
backgrounding; a Wi-Fi drop suspends it and it resumes within
`graceSeconds` (default 600; set `"graceSeconds": 3600` in
`~/.appduct/config.json` next to the policy for a booth day, then restart the
daemon once). It ends when the app process dies (swiped away, crashed, phone
restarted) or the daemon restarts (laptop reboot, `appduct daemon stop`):
pair again. Check it each morning with `appduct sessions ls`, and after
anyone relaunches the app.

## Rollback

A maintainer, from `apps/mobile`:

```sh
eas update:rollback <update-group-id> --non-interactive
```

`<GROUPID>` must be the latest update group of its branch and runtime version.
The group published before it is republished; if there is none, binaries are
rolled back to the update embedded in them. The app reads a rollback as an
update with `rollback: true` and the banner says so. `eas update:republish`
republishes an older group instead. Agents never run either (safety rule 4).

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| The run fails with "Needs a native build" | No finished `production` build has the merged commit's fingerprint. Build one (above). |
| `eas fingerprint:generate` differs from the build's | `APPDUCT_ENABLED` was not `1`: pass `--build-profile production`. A file under `node_modules` that a build rewrites needs an `ignorePaths` entry in `fingerprint.config.js`. |
| `eas update` fails asking for `--environment` | SDK 55+ requires it. The workflow passes `--environment production`. |
| No banner, the footer says `embedded · none` | The binary has no channel: a local `expo run` build, a debug build, or Expo Go. Only EAS builds carry one. |
| No banner, the footer says `embedded · lane` | A `lane` binary: nothing is published there. |
| No banner on a `production` binary | Its runtime version is not the published one (`app_info` reports `fingerprint`; compare with the run summary), or the `production` channel points at a branch that received nothing. |
| An update is applied but shows old values | The bundle was built without the `production` environment's `EXPO_PUBLIC_*` values. |
