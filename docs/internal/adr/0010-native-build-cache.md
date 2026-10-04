# 0010 — A native build cache keyed by the OTA fingerprint, shared by Expo and the device lanes

Status: Accepted

## Context

Every simulator check compiled the app: about 7 minutes for a Debug build and
up to 20 for a cold Release build in `device-lane.sh`, per PR, although almost
every booth PR changes JavaScript only. A binary built for one native
fingerprint runs any JS bundle built for that fingerprint; that is exactly the
promise OTA updates rely on (ADR 0003).

Expo has a mechanism for reusing native builds: a build cache provider
(`buildCacheProvider` in the app config), consulted by
`npx expo run:[ios|android]` for simulator and emulator builds through
`resolveBuildCache` / `uploadBuildCache` and an optional
`calculateFingerprintHash`. It installs a cached binary as it is, so for a
Release build it would install the cached binary's old JS. The device lanes
cannot use `expo run:ios` itself: it cannot see simlock's private device set,
so they build with `xcodebuild` for a generic destination (ADR 0007).

## Decision

1. **One cache, one key.** `tools/expo-build-cache/` holds an Expo build cache
   provider (`provider.plugin.js`) and a CLI (`cli.js`) over the same module.
   The key is the platform, the profile (Release or Debug) and the OTA
   fingerprint as hot-updater computes it (`calculateFingerprintHash` runs
   `hot-updater fingerprint` with the project's config: `app.json` as an extra
   source, `APPDUCT_ENABLED=1`). So a cached binary is exactly the binary an
   OTA bundle for that hash targets, and `expo run` and the lanes agree.
2. **Local directory, not MinIO.** Entries live in
   `~/.cache/apex-software-factory/native/<platform>/<fingerprint>/<profile>/`
   (`APEX_BUILD_CACHE_DIR` overrides), eight fingerprints per platform. Every
   builder — the developer, both factory runners, every agent lane — is the
   same user on the same laptop; an APFS clone of a cached app costs nothing;
   and an agent lane never needs the S3 credentials, which live in `.env`
   files agents may not read (safety rule 1). MinIO would only pay off with a
   second machine; the provider is the one place to add it then.
3. **The JS swap is ours.** A Release hit returns a copy of the cached binary
   with this checkout's JavaScript in it, built the way the native bundle step
   builds it: `expo export:embed` (unminified), `hermesc -O`, the assets, and
   on iOS the embedded Expo config; a signed iOS app is re-signed ad hoc, an
   APK is zipaligned and signed with the debug key it was built with. A
   change that adds a JS image the cached APK lacks needs compiled resources,
   so it is a miss. A Debug hit needs no swap: it loads JS from Metro.

   Callstack's Rock CLI has a similar command (`rock sign:ios <app> --app
   --jsbundle <file>` / `--build-jsbundle`, `rock sign:android`). Rock 0.15.2
   does not fit this app as is, read from its source
   (`@rock-js/platform-apple-helpers`, `commands/sign/modifyApp.js` and
   `bundle.js`): `--jsbundle` copies the one bundle file and leaves the assets
   and the embedded Expo config stale; `--build-jsbundle` hard-codes
   `--entry-file index.js` and builds through `rock bundle`, while this Expo
   Router app's entry is `expo-router/entry` and needs Expo's Metro
   serializer (`expo export:embed`); and the `sign:*` commands exist only
   through platform plugins in a `rock.config` the project does not have.
   Our swap also dates the binary and turns its OTA client off (below), which
   no signing tool would. Revisit when Rock can take an Expo entry and swap
   assets; `rock sign:android` would then replace our zip/zipalign/apksigner
   steps.
4. **The lanes use it.** `device-lane.sh build` computes the fingerprint,
   resolves from the cache, and only on a miss takes a build slot, compiles,
   and stores the binary under the hash it embeds. `APEX_BUILD_CACHE=0`
   always compiles. `.agents/scripts/prewarm.sh` fills the cache for the
   current fingerprint each booth morning.
5. **`expo run` uses it** once `apps/mobile/app.json` carries
   `"buildCacheProvider": { "plugin": "../../tools/expo-build-cache/provider.plugin.js" }`.
   That line is part of `app.json`, which is part of the fingerprint, so it
   lands with the next native build.
6. **Precompiled Expo Modules stay on.** SDK 57 links precompiled Expo modules
   on iOS by default; nothing in the repository may set
   `EXPO_USE_PRECOMPILED_MODULES=0`, `usePrecompiledModules: false` or
   `buildFromSource`, and the lanes unset the variable. Third-party native
   libraries still compile from source on a miss.

## Consequences

- Measured on the temporary dev Mac (4 Oct 2026, iPhone 17 Pro simulator,
  Release): a miss compiled in 244 s and installed in 7 s; a JS-only change
  then built in 15–17 s (export, Hermes, swap) and installed in 4–18 s, and
  the app ran the new JS from its embedded bundle (`app_info`:
  `embedded: true`).
- **Lane binaries take no OTA update.** Found in the first timed run: a
  cached binary, dated to its first build, was offered production's latest
  bundle, staged it, and applied it on relaunch, so the check ran production's
  JS instead of the PR's. Now a lane's Release bundle is built with
  `EXPO_PUBLIC_OTA_URL` pointing at a port nothing listens on (the OTA client
  fails fast and quietly), and its iOS binary is dated to now
  (`HOT_UPDATER_BUILD_TIMESTAMP`, which hot-updater reads as MIN_BUNDLE_ID).
  The OTA check alone sets `APEX_LANE_OTA=on`: the booth's OTA URL, and a
  binary dated to the parent commit, so the merge's bundle arrives. Android
  carries MIN_BUNDLE_ID in compiled code; the unreachable URL covers it.
- A cache entry is trusted: a binary built from a dirty tree with the same
  fingerprint would be reused. Lane builds come from committed worktrees, and
  the lane stores under the hash the binary embeds, not the one it expected.
- The cache grows by one Release app per fingerprint and platform (about
  100 MB); pruning keeps eight.
- The swap re-implements the native bundle step. An Expo or React Native
  upgrade that changes it (flags, output paths, the Hermes compiler) must be
  checked against a full build once.
- Delivery rule 16's "a native build holds no lease" stands; a hit holds no
  build slot either.
