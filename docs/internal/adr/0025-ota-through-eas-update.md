# 0025 — OTA updates through EAS Update

Status: Accepted

Supersedes [0003](0003-ota-through-self-hosted-hot-updater.md).

## Context

ADR 0003 ran the OTA path on the booth laptop: a hot-updater server, MinIO,
a self-hosted runner and Docker. The factory is moving to GitHub-hosted
runners and Expo's services, which leaves nothing for that stack to run on,
and removes the reason to keep phones: every binary is a simulator build or an
Android APK, built on EAS.

## Decision

1. **The app uses `expo-updates` against EAS Update.** `app.json` sets
   `updates.url` to the project's `https://u.expo.dev/<projectId>` and
   `runtimeVersion: { policy: "fingerprint" }`: an update only reaches
   binaries with the same native fingerprint, as in 0003. A native change
   cannot ship over the air.
2. **The app checks for itself.** `updates.checkAutomatically` is
   `ON_ERROR_RECOVERY` and `fallbackToCacheTimeout` is `0`: the `ota` module
   already checks on start, on foreground and every 30 s, stages the bundle and
   shows the banner, so the launch-time check of `ON_LOAD` would only
   download the same update a second time without telling anyone.
3. **Two kinds of binary share one fingerprint**, both built on EAS from
   `apps/mobile/eas.json` with iOS `simulator: true` (Release) and Android
   `buildType: "apk"`, and `APPDUCT_ENABLED=1`:
   - `production` (channel `production`, EAS environment `production`): what
     the booth runs. Merges to `main` publish to this channel.
   - `lane` (channel `lane`, EAS environment `preview`): per-PR verification
     binaries whose JS is replaced with the PR's bundle. Nothing is ever
     published to `lane`, so they cannot adopt a production update.
4. **`ota-publish.yml` runs on `ubuntu-24.04`.** For each platform it computes
   the fingerprint with the `production` profile and looks for a finished
   `production` EAS build with it. All found: `eas update --channel production
   --environment production`. Any missing: nothing is published, the merged PR
   gets `needs-native-build` and a comment, as before.
5. **The fingerprint is configured in `apps/mobile/fingerprint.config.js`.**
   It hashes the local config plugins as an extra source and ignores
   `react-native-maps`' `RNMapsDefines.h`, which a build phase rewrites. This
   replaces `extraSources` and the node_modules reset of ADR 0013 (items 6 and
   7), and `fingerprint.json` no longer exists: the binary embeds its
   fingerprint as its runtime version.
6. **The `updater` port loses `start()`.** `expo-updates` starts itself. An
   EAS update carries no deploy message and no force flag, so the adapter
   reports `message: null` and `forced: false`.
7. **Only CI publishes.** Safety rule 5 stands. Agents are denied
   `eas update`, `channel`, `branch`, `build`, `workflow`, `env` and `submit`,
   in the `eas` and `eas-cli` spellings (ADR 0012's list); the workflow's
   `EXPO_TOKEN` secret replaces the OTA token and S3 credentials.

## Consequences

- `apps/ota-server`, `infra/` (MinIO), `hot-updater` and the `ota-*` CI
  scripts are gone. The booth laptop no longer runs Docker or an OTA runner
  for this.
- `eas.json` is a fingerprint source (checked: editing a channel or the pnpm
  version moves the hash), so any edit to it needs new `production` builds.
- Every merge's native fingerprint needs a finished `production` EAS build
  before it can ship; a native change waits for a maintainer to build one.
- The native build cache (ADR 0010) now keys on `@expo/fingerprint` directly,
  the same hash. Its lane OTA switches (`APEX_LANE_OTA`, the baseline stamp)
  were hot-updater specific and no longer have an effect; device lanes move to
  Expo Simulators in a later record.
- ADR 0006's exemption of the OTA server from the OpenAPI rule has nothing
  left to apply to.
