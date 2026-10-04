# 0013 — The booth binary carries the native libraries booth features are likely to need

Status: Accepted

## Context

Booth visitors propose features; agents ship them over the air, and an OTA
update cannot add native code (ADR 0003: fingerprint strategy). A visitor's
idea that needs a camera, a map, a database or a canvas would otherwise be
"needs native build" — a maintainer, a rebuild and a reinstall on every booth
phone in the middle of the conference. The phones are installed once, before
the event.

## Decision

1. **The booth binary carries a fixed, maintainer-approved set of native
   libraries ahead of demand**: Skia, MMKV (Nitro), expo-sqlite, VisionCamera
   v5, local notifications, calendar, image picker, sharing, media library,
   maps and location, SVG, gradient, blur, sensors, keyboard-controller,
   clipboard, speech and WebView, on top of what the app already had. The
   authoritative list, with versions, permissions and limits, is
   [NATIVE-CAPABILITIES.md](../NATIVE-CAPABILITIES.md); a spec that needs
   anything not on it is "needs native build".
2. **Permissions are declared, never asked at start.** Each library's
   permission strings are in `app.json`; a feature asks at the moment it needs
   one. Permissions the set does not need are blocked (microphone, background
   location, audio media, reminders).
3. **No credentials in the binary.** Notifications are local only: the push
   entitlement Expo's plugin adds is removed by a local config plugin, and no
   APNs/FCM setup exists. Android Google Maps takes its key from
   `GOOGLE_MAPS_ANDROID_API_KEY` at prebuild, with a non-crashing placeholder
   when unset; iOS uses Apple Maps, which needs no key.
4. **QR scanning follows VisionCamera's own recommendation**: the core object
   output on iOS, and `react-native-vision-camera-barcode-scanner` (MLKit) on
   Android only, excluded from iOS autolinking because MLKit has no iOS
   simulator binaries. This is the one package beyond the approved list; it
   exists to make the approved camera usable for QR codes on Android.
5. **The binary can be asked what it has.** The appduct tool
   `native_capabilities` and the hidden `/_capabilities` route probe every
   library's native module cheaply and without prompts, so agents check the
   running binary rather than `package.json`.
6. Local config plugins live in `apps/mobile/plugins/` and are part of the
   OTA fingerprint (`extraSources` in `hot-updater.config.ts`), like
   `app.json`.
7. **The fingerprint must not depend on whether the checkout has built.**
   expo-sqlite's `pod install` and a react-native-maps build phase write
   files into `node_modules` that the fingerprint hashes, which made a
   rebuilt binary embed a hash CI never computes. `hot-updater.config.ts`
   restores them to their published state whenever it loads (every prebuild
   and every `ota:*` command), because hot-updater's `ignorePaths` cannot
   exclude files its source allowlist admits.

## Consequences

- The binary is larger and slower to build (first iOS build with pods several
  minutes longer); the sizes are recorded in the PR that introduced the set.
- Every booth phone needs the new binary and the new fingerprint; bundles
  for the previous fingerprint no longer reach it.
- Store review would ask why an empty app declares camera, location and
  calendar access; the booth binary is never submitted, but a store build
  would trim the set to what shipped.
- Adding to the set later is still a native change with the usual rebuild.
