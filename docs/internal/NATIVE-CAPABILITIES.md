# Native capabilities of the booth binary

The authoritative list of native code in the Apex Factory binary on the booth
phones. Booth features ship over the air, and an OTA update can only replace
JavaScript and assets ([ADR 0003](adr/0003-ota-through-self-hosted-hot-updater.md)),
so a feature can use exactly the native libraries listed here, with the
permissions listed here — nothing else. Why the binary carries libraries no
feature uses yet: [ADR 0013](adr/0013-booth-binary-bundles-native-capabilities.md).

**The rule:** a spec that needs a native library, permission, entitlement,
plugin option or `app.json` change that is not on this page is
**needs native build**. Say so in the spec; the change is parked with the
`needs-native-build` label for a maintainer (delivery rule 17). A JavaScript
package with no native code can be added over the air (see
[JS-only libraries](#js-only-libraries-can-ship-over-the-air)).

## Check what a running binary has

- appduct tool **`native_capabilities`** (group `native`, read-only): every
  library below with `linked`, `missing` or `not-on-platform`, the modules
  that did not load, and `allLinked`. The check asks the module registries
  (Expo modules, TurboModules, Nitro hybrid objects); it never prompts for a
  permission. `.agents/scripts/device-lane.sh appduct call native_capabilities`.
- Hidden route **`/_capabilities`** (not linked from the home screen):
  `open_route {"path":"/_capabilities"}`. The same probe as chips, then a live
  smoke per library: Skia draws offscreen and reads the pixel back and shows a
  canvas, MMKV and SQLite round-trip, SVG / gradient / blur / WebView (a
  HTML page whose script posts back) / map views report that they rendered,
  sensors report availability, the clipboard round-trips, the
  keyboard-controller provider is found, and camera, notification, calendar,
  location and photo permissions are **read, never requested**. testIDs:
  `capabilities-summary`, `capability-<id>`, `smoke-<id>`.
- Code: `apps/mobile/src/modules/capabilities/native-capabilities.ts` (the
  probe list — keep it in step with this page) and the rest of
  `apps/mobile/src/modules/capabilities/`.

Evidence of the first binary with this set (Release builds, iOS simulator
and Android emulator): `apps/mobile/docs/native-capabilities/` — the
`native_capabilities` output per platform and screenshots of `/_capabilities`.

## In the binary

Versions are the installed ones (Expo SDK 57, React Native 0.86, New
Architecture). Expo packages follow the SDK (`expo install`); the others are
pinned exactly in `apps/mobile/package.json`.

### Added for booth features

| Library | Version | What a feature can do with it | Permissions it uses | Limits |
| --- | --- | --- | --- | --- |
| `@shopify/react-native-skia` | 2.6.2 | 2D drawing, paths, shaders, image filters, offscreen rendering, Skia + Reanimated animations | — | — |
| `react-native-mmkv` | 4.3.2 | fast synchronous key-value storage (`createMMKV()`, hooks) | — | v4 API: `createMMKV`, `.remove()`; keep data well under 100 MB |
| `react-native-nitro-modules` | 0.37.1 | runtime for MMKV and VisionCamera | — | — |
| `expo-sqlite` | 57.0.3 | on-device SQLite (sync and async API, `useSQLiteContext`) | — | default build flags: no SQLCipher, no FTS/vec extension options set |
| `react-native-vision-camera` | 5.2.3 | camera preview, in-memory photos (`usePhotoOutput`), video without audio, **QR/barcode scanning on iOS** with `useObjectOutput` | Camera | v5 API only (outputs, constraints; no `takePhoto`, no `format`). No microphone permission, so no audio in recordings. No frame processors (`react-native-vision-camera-worklets` is not in the binary). |
| `react-native-nitro-image` | 0.15.2 | VisionCamera's in-memory `Photo` → image | — | peer of VisionCamera |
| `react-native-vision-camera-barcode-scanner` | 5.2.3 | **QR/barcode scanning on Android** (MLKit, `useBarcodeScannerOutput`) | Camera | **Android only**: excluded from iOS autolinking (`expo.autolinking.ios.exclude`) because MLKit ships no iOS simulator binaries. Use `Scanner.ios.tsx` (object output) + `Scanner.android.tsx` (barcode scanner). |
| `expo-notifications` | 57.0.21 | **local** notifications: schedule, present, badge, tap handling | Notifications (asked at runtime; Android 13+ `POST_NOTIFICATIONS`) | **Local only.** No push: no APNs `aps-environment` entitlement (removed by `plugins/with-local-notifications-only.js`), no FCM `google-services.json`, no push tokens. |
| `expo-calendar` | 57.0.5 | read calendars and events, add events | Calendar (iOS full access; Android `READ_CALENDAR`, `WRITE_CALENDAR`) | No reminders (iOS reminders keys removed). **SDK 57 API:** `expo-calendar` exports the new object-oriented API (`getCalendarPermissions`, `getCalendars`, `ExpoCalendar`); the old `*Async` functions still type-check but **throw at runtime** — use them only from `expo-calendar/legacy`. |
| `expo-image-picker` | 57.0.20 | pick a photo or video from the library, take a photo with the system camera UI | Photo library (read), Camera | No microphone: recording video with sound from the picker is blocked. |
| `expo-sharing` | 57.0.22 | system share sheet for a file (`shareAsync`) | — | Sharing *into* the app (share extension) is off. |
| `expo-media-library` | 57.0.5 | save images to the photo library, read assets | Photo library read and add; Android `READ_MEDIA_IMAGES` (+ legacy storage ≤ API 32) | Photos only on Android 13+: video and audio granular permissions are not declared. **SDK 57 API:** the default export is the new class-based API; `saveToLibraryAsync`, `createAssetAsync`, `getAssetsAsync` and the other legacy functions **throw at runtime** unless imported from `expo-media-library/legacy` (`getPermissionsAsync` still works). |
| `react-native-maps` | 1.27.2 | map views, markers, polylines, regions | — (pair with `expo-location` for the user's position) | **iOS: Apple Maps, no key.** **Android: Google Maps needs an API key at build time** (below); without one the map renders as an empty grid. No Google Maps on iOS. |
| `expo-location` | 57.0.20 | current position, watch position, geocoding, heading | Location **when in use** | No background location (iOS "always" keys removed, Android `ACCESS_BACKGROUND_LOCATION` blocked), no geofencing in the background. |
| `react-native-svg` | 15.15.4 | SVG shapes, icons, charts drawn as SVG | — | — |
| `expo-linear-gradient` | 57.0.2 | gradient backgrounds | — | — |
| `expo-blur` | 57.0.3 | blurred translucent views | — | Android blur is approximate (see Expo docs). |
| `expo-sensors` | 57.0.3 | accelerometer, gyroscope, magnetometer, barometer, device motion, pedometer, light sensor (Android) | Motion (iOS, for pedometer and device motion) | Simulators report most sensors unavailable; test on a phone. |
| `react-native-keyboard-controller` | 1.21.9 | keyboard-aware scroll views, sticky views, toolbar, keyboard animations | — | `KeyboardProvider` is mounted once in `src/app/_layout.tsx` (`AppKeyboardProvider`). |
| `expo-clipboard` | 57.0.2 | copy and paste text and images | — (iOS shows its paste banner when reading another app's content) | — |
| `expo-speech` | 57.0.3 | text to speech | — | No speech recognition. |
| `react-native-webview` | 13.16.1 | embedded web pages, HTML strings, `postMessage` bridge | — | **iOS: never pass a `data:` (or any host-less) `uri`** — the library hands it to `loadFileURL`, which throws and crashes the app; use `source={{ html }}`. Plain HTTP only to the laptop's LAN (ATS local networking). |

### Already in the app before

| Library | Version | What it gives |
| --- | --- | --- |
| `react-native-gesture-handler` | 2.32.0 | native gestures; `GestureHandlerRootView` wraps the app in `src/app/_layout.tsx` |
| `react-native-reanimated` + `react-native-worklets` | 4.5.1 + 0.10.1 | UI-thread animations, layout animations, worklets |
| `expo-haptics` | 57.0.3 | haptic feedback |
| `expo-image` | 57.0.5 | fast cached images, blurhash |
| `expo-symbols` | 57.0.3 | SF Symbols (iOS only) |
| `expo-glass-effect` | 57.0.4 | Liquid Glass views (iOS only) |
| `@expo/ui` | 57.0.21 | SwiftUI and Jetpack Compose components |
| `expo-web-browser` | 57.0.3 | in-app browser sheet |
| `expo-device` | 57.0.2 | device model and OS facts |

Plus the app's infrastructure: Expo Router, `react-native-screens`,
`react-native-safe-area-context`, hot-updater, appduct (agent tools), and the
Expo modules they depend on.

## Permissions declared

Every string is in `apps/mobile/app.json` (plugin options and
`ios.infoPlist`). A permission is only *asked* when a feature calls the
library's `request…` function; the app asks nothing at start. A feature must
ask at the moment it needs the permission, after the visitor has chosen the
feature, and keep working (with a message) if the answer is no.

| Permission | iOS key | Android | Purpose string (iOS) |
| --- | --- | --- | --- |
| Camera | `NSCameraUsageDescription` | `CAMERA` | uses the camera for booth features you try, like scanning a QR code or taking a photo; nothing is uploaded |
| Photo library (read) | `NSPhotoLibraryUsageDescription` | `READ_MEDIA_IMAGES`, `READ_MEDIA_VISUAL_USER_SELECTED` (+ `READ/WRITE_EXTERNAL_STORAGE` ≤ API 32) | opens your photo library only when you pick a photo |
| Photo library (add) | `NSPhotoLibraryAddUsageDescription` | as above | saves pictures you create in a booth feature |
| Location, when in use | `NSLocationWhenInUseUsageDescription` | `ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION` | uses your location while the app is open, e.g. on a map |
| Calendar | `NSCalendarsUsageDescription`, `NSCalendarsFullAccessUsageDescription` | `READ_CALENDAR`, `WRITE_CALENDAR` | reads and adds events, e.g. saving a reactCon session |
| Motion | `NSMotionUsageDescription` | `ACTIVITY_RECOGNITION` (from expo-sensors, for the pedometer) | reads motion sensors, e.g. a step counter |
| Notifications | — (runtime prompt) | `POST_NOTIFICATIONS` (from expo-notifications) | — |
| Local network | `NSLocalNetworkUsageDescription` | cleartext to the laptop | OTA updates from the booth laptop (not new) |

Blocked on purpose (`android.blockedPermissions`, and the matching iOS keys
left out): microphone (`RECORD_AUDIO`), background location
(`ACCESS_BACKGROUND_LOCATION`, iOS "always"), `READ_MEDIA_AUDIO`, iOS
reminders. A feature that needs one of these is **needs native build**.

## Platform limits

- **Android maps need a key.** Google Maps reads
  `com.google.android.geo.API_KEY` from the manifest. Set
  `GOOGLE_MAPS_ANDROID_API_KEY` in the environment when building the Android
  binary (`plugins/with-android-maps-key.js` writes it at prebuild; never
  commit it; restrict it in Google Cloud to `com.callstack.apexfactory` and
  the signing certificate). Without it the binary gets a placeholder value:
  it builds and a `MapView` mounts, but shows no tiles. A real key needs a new
  Android binary (the manifest is native), but not a new fingerprint: the key
  is a build input like the `EXPO_PUBLIC_*` URLs. iOS needs nothing.
- **Notifications are local.** Scheduling and presenting notifications works
  on both platforms; remote push (APNs, FCM, Expo push tokens) does not, and
  `getExpoPushTokenAsync` / `getDevicePushTokenAsync` fail. Push is a native
  change (entitlement, credentials).
- **QR scanning differs per platform**: VisionCamera's object output on iOS,
  the MLKit barcode scanner on Android. One component with `.ios.tsx` and
  `.android.tsx` files hides it.
- **No audio capture**: no microphone permission, so no voice recording,
  speech recognition or video with sound.
- **Simulators**: no camera, few sensors, Apple Maps works. On a freshly
  erased simlock simulator, reading the clipboard (`getStringAsync`) and
  listing speech voices (`getAvailableVoicesAsync`) did not answer within 5 s;
  on a simulator that had been used before both answered (68 voices). Verify
  camera, sensor, clipboard and speech features on a phone.
- **iOS-only libraries**: `expo-symbols`, `expo-glass-effect` (Android falls
  back to plain views or must branch on `Platform.OS`).
- **WebView `data:` URLs crash on iOS** (react-native-webview 13.16 passes a
  host-less URL to `loadFileURL`, which throws). Load HTML with
  `source={{ html, baseUrl }}`; found by the `/_capabilities` smoke.
- **The Android release APK is large** (about 230 MB for four ABIs, mostly
  Skia's native libraries); `plugins/with-android-build-memory.js` gives
  Gradle 4 GB so packaging does not run out of memory.

## Not in the binary

A spec that needs any of these is **needs native build**:

- Push notifications (APNs entitlement, FCM, Expo push service)
- `lottie-react-native` (Lottie animations — use Skia or Reanimated)
- `expo-camera` (use VisionCamera)
- `expo-contacts`, `expo-secure-store`, `expo-local-authentication`
  (Face ID / fingerprint), NFC (`react-native-nfc-manager`), Bluetooth
- `expo-video`, `expo-audio`, `expo-av`: audio and video playback or
  recording; any microphone use, speech recognition
- `expo-document-picker`, `expo-print`, `expo-mail-composer`, `expo-sms`
- `expo-background-task`, `expo-task-manager`, background location, geofencing
- In-app purchases, Apple Pay / Google Pay, Sign in with Apple, Google Sign-In
- VisionCamera frame processors (`react-native-vision-camera-worklets`),
  `react-native-vision-camera-resizer`, `react-native-vision-camera-skia`
- Widgets, App Clips, Live Activities, share extensions, any app extension
- Google Maps on iOS, a Google Maps key on Android without a rebuild

Expo also links a few modules only as dependencies of others
(`expo-file-system`, `expo-keep-awake`, `expo-application`,
`expo-asset`). They are in the binary, but the app cannot import them until
they are direct dependencies; adding one at the exact linked version should
leave the fingerprint unchanged — prove it with `ota:fingerprint` before
calling it JS-only.

When in doubt, check the running binary with `native_capabilities`: a library
whose module is not linked cannot be added by an update.

## JS-only libraries can ship over the air

A package with no native code (no `ios/`, `android/`, podspec, `expo-module.config.json`
or config plugin) only changes the JS bundle, so the fingerprint stays the
same and a booth feature may add it with `pnpm exec expo install <pkg>` from
`apps/mobile`. Check before relying on it: run
`pnpm --filter @apex/mobile run ota:fingerprint` after installing — it must
still match `fingerprint.json` — and `.agents/scripts/native-check.sh` (which
flags *every* dependency change in `package.json` for a person to look at).
Good fits built on what is linked here:

- `@shopify/flash-list` v2 (pure JS on the New Architecture)
- `@gorhom/bottom-sheet` (Reanimated + Gesture Handler)
- `victory-native` (Skia + Reanimated charts)
- `zustand`, `jotai`, `@tanstack/react-query`, `date-fns`, `zod` (already
  present)
- `react-native-qrcode-svg` (QR *generation* on top of `react-native-svg`)
- `@react-navigation/*` pieces Expo Router already depends on

A package whose README says "run `pod install`", "rebuild the app" or "add
the config plugin" is native: needs native build.

## Fingerprint hygiene

Two of these libraries write into `node_modules` during a native build:
`pod install` copies expo-sqlite's SQLite amalgamation to
`expo-sqlite/ios/sqlite3.{c,h}`, and a react-native-maps build phase rewrites
`ios/AirMaps/RNMapsDefines.h`. The fingerprint hashes both (hot-updater's
`ignorePaths` cannot exclude them), so a checkout that had built once would
embed a fingerprint that CI's fresh checkout never computes, and no update
would reach the phone. `hot-updater.config.ts` therefore puts them back to
their published state whenever it loads (every `expo prebuild` and every
`ota:*` command) — so never run an `ota:*` command in a checkout while its
Xcode build is compiling: the build needs those files. A new native library that writes into `node_modules` needs
the same treatment: after a build, `pnpm --filter @apex/mobile run
ota:fingerprint` must still match the fingerprint embedded in the binary.

## Changing this list

Adding, removing or upgrading a native library, or changing a permission, is
a native change: update `apps/mobile/package.json` (with `expo install`),
`app.json`, `src/modules/capabilities/native-capabilities.ts` and this page in one PR,
regenerate `fingerprint.json` (a prebuild writes it; `pnpm --filter
@apex/mobile run ota:fingerprint` must then match it), and build and install a new binary on every booth phone
([OTA.md](OTA.md#fingerprints-how-a-bundle-finds-its-binary)).
