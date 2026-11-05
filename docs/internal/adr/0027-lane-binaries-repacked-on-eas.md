# 0027 — Lane binaries are the production build repacked on EAS

Status: Accepted

Supersedes [0010](0010-native-build-cache.md).

## Context

ADR 0010 cached native builds on the booth laptop and swapped the checkout's
JavaScript into them. ADR 0025 moved every binary to EAS and left the cache
keyed on the same fingerprint with nothing left to cache for. A `production`
build with the current fingerprint already holds the native code a lane needs;
only its JavaScript and update channel differ.

EAS can repack a finished build under another profile without compiling. A
repack keeps the channel embedded in the original: a repacked lane binary still
carries `expo-channel-name: production` and would download production updates,
replacing the JavaScript under test.

## Decision

1. **Lane binaries come from the EAS workflow
   `apps/mobile/.eas/workflows/lane-binary.yml`.** It computes the fingerprint,
   looks for a finished `production` build with it, and repacks that build with
   the `lane` profile. With no such build it runs a full `lane` build.
   `.agents/scripts/lane-binary.sh <ios|android>` runs the workflow and prints
   the resulting build id.
2. **The `lane` profile sets `EXPO_PUBLIC_UPDATES_CHANNEL=lane`.** Because a
   repack keeps the embedded production channel, the `updater` adapter reads
   the variable and, when it differs from the embedded channel, calls
   `Updates.setUpdateRequestHeadersOverride({ "expo-channel-name": "lane" })`
   before any check. `production` sets nothing and behaves as before.
3. **Nothing publishes to `lane`.** A lane binary asks a channel with no
   updates, so it runs exactly the JavaScript it was repacked with.
4. **Any edit to `eas.json` changes the fingerprint** (it is a fingerprint
   source, ADR 0025), so it needs new `production` builds before a lane can
   repack one.

## Consequences

- A lane binary costs a repack, not a compile, once the `production` build for
  the fingerprint exists; a native change pays one full `lane` build.
- `tools/expo-build-cache/` and `buildCacheProvider` in `app.json` stay until
  `device-lane.sh` moves to Expo Simulators, and are removed then.
- The override can only replace header keys embedded in the build; ours
  embeds `expo-channel-name`, so it needs no `disableAntiBrickingMeasures`. It
  replaces all custom request headers, and the app sets no others.
