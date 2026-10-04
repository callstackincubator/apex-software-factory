# apps/mobile

Expo SDK 57 app with Expo Router, run as a development build. Read
[README.md](README.md) for how to run it and how to ship a feature into the
"Shipped at the booth" list.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. Before writing code that
touches an Expo or React Native API, check the installed version in
`package.json` and read the matching docs at
`https://docs.expo.dev/versions/v57.0.0/`, or start from
https://docs.expo.dev/llms.txt.

## Rules

- Routes live in `src/app/`; every file there is a screen. Keep components,
  hooks and tests out of it.
- Add dependencies with `pnpm exec expo install <package>` (from `apps/mobile`)
  so versions match the SDK.
- `ios/` and `android/` are generated (Continuous Native Generation). Never
  commit or hand-edit them; configure native behaviour in `app.json`.
- OTA updates use hot-updater (ADR 0003), not EAS Update. A change that adds or
  upgrades native code changes the fingerprint and needs a new native build —
  avoid it for booth features.
- Colours, spacing and fonts come from `src/theme.ts`; support light and dark,
  safe areas, Dynamic Type and accessibility labels.
- Run `pnpm check` from the repo root before declaring a task done.
