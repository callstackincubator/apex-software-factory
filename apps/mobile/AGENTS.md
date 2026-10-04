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

- Routes live in `src/app/`; every file there is a screen, except
  `+native-intent.tsx` (Expo Router's deep-link hook; it keeps appduct's
  pairing link from navigating). Keep components, hooks and tests out of it.
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

## Agent tooling rules

How agents drive the app is in [README.md](README.md#agent-tooling).

- Every interactive or key element gets a `testID` (kebab-case, unique on its
  screen, e.g. `status-api`) and an `accessibilityLabel` that states what it
  shows. agent-device selectors (`id="…"`, `label="…"`) and `.ad` scripts
  depend on them; renaming one is a breaking change for `e2e/*.ad`.
- A device-level claim gets an agent-device replay script in `e2e/<name>.ad`
  that passes on a debug and a release build.
- A feature that needs state, an event or a deep screen to test registers
  appduct tools for it: `src/features/<id>/agent-tools.ts` exporting a
  `FeatureAgentTools`, appended to `featureAgentTools` in
  `src/features/agent-tools.ts`. Core tools live in `src/dev/agent-tools.ts`;
  besides those, only `src/app/_layout.tsx` imports `@appduct/react-native`
  (its `/auto` entry, which handles pairing).
- Tool design (appduct's `writing-tools.md`): name by intent
  (`seed_cart`, not `set_state`); a zod `inputSchema` with `.describe()` on
  every field; an object `outputSchema`; a first description line that says
  what it does, then preconditions; `readOnlyHint: true` on observers; a
  mutation returns the new state and has an observer; `idempotentHint` where
  a retry is safe; `timeoutMs` when it touches the network.
- Tools ship in the booth binary and in every OTA bundle (`APPDUCT_ENABLED=1`
  everywhere, never gated on `__DEV__`). So a tool never returns a secret or
  a visitor's data, and anything that deletes, resets, signs out or restarts
  sets `destructiveHint: true` (the operator's policy denies those
  unattended). Handlers are plain functions over injected dependencies, with
  Jest tests next to them.
- Rozenite stays a debug-only aid: plugin hooks only in `src/dev/devtools.tsx`
  (loaded by a `require` under `__DEV__`, so release and OTA bundles carry
  none of it), only JS-only plugins (no `performance-monitor`,
  no `react-navigation`), and `metro.config.js` keeps it behind
  `WITH_ROZENITE=true`.
