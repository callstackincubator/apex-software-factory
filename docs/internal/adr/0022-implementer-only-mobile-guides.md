# 0022 — Expo and React Native guides for the implementer only, loaded by name

Status: Accepted

## Context

The implementer writes Expo SDK 57 and React Native 0.86 code, and the model
it runs on knows older APIs: Expo Router before native tabs and form sheets,
Reanimated before CSS transitions, VisionCamera v4, MMKV v3. Expo, Software
Mansion, Callstack, Vercel and Margelo publish skills for exactly these
libraries.

ADR 0019 keeps global skills out of factory runs, so a skill reaches the
factory only from `.agents/skills/`. OpenCode adds every skill there to every
agent's system prompt. That has two costs. The other agents pay for skills they
never use, and ADR 0019 tied the endpoint's garbled turns to the prompt's
shape. Most of these skills also describe themselves as "MUST USE for any
React Native code", which would pull in more of them than a change needs.

OpenCode 2.0.22, read from its source:

- A skill's id is its directory name. The `skill` permission matches that id;
  a denied skill is left out of the agent's list and cannot be loaded.
- `metadata.opencode/autoinvoke: false` in a skill's frontmatter leaves it out
  of every agent's list. The `skill` tool still loads it by id.
- Discovery takes every `**/SKILL.md` under the skills directory, nested ones
  included.

## Decision

1. **Eleven upstream skills are vendored into `.agents/skills/`**, each with a
   `SOURCE.md` naming the commit and the local changes: `expo-router`,
   `expo-native-ui`, `expo-ui`, `expo-animation`, `expo-data-fetching`,
   `expo-design-system` (Expo); `swm-react-native-best-practices`, with only
   the animations, gestures, SVG and multithreading sub-skills (Software
   Mansion); `callstack-react-native-best-practices` (Callstack);
   `vercel-composition-patterns` (Vercel); `react-native-mmkv` and
   `react-native-vision-camera` (Margelo). Both best-practices skills are
   called `react-native-best-practices` upstream; the vendor prefix keeps their
   ids apart. Skills for native modules, deployment, EAS, upgrades, Tailwind,
   DOM components and web are left out, because no booth feature can use them.
2. **No agent's prompt lists them.** Each has `opencode/autoinvoke: false`.
   Nothing loads eagerly, and no agent's system prompt grows.
3. **Only the implementer may load them.** `opencode.json` denies the eleven
   ids to every agent; `implementer.md` allows them again, and so does `build`
   for people.
4. **The `implement` skill names them.** A table in its step 4 maps what a
   change does (a route, an animation, a gesture, a list, MMKV, the camera) to
   the skills to load before writing that code. The repository's rules win
   where a guide disagrees.

## Consequences

- The implementer gets current guidance for the booth binary's libraries and
  loads only the guides a change needs. The other agents' prompts are
  unchanged.
- A guide the table does not name is never used. Adding one means vendoring
  it, adding `opencode/autoinvoke: false`, denying its id in `opencode.json`,
  and adding a row to the table.
- A vendored skill must not contain a nested `SKILL.md`. OpenCode would list it
  as a skill of its own, in every agent's prompt. Software Mansion's
  sub-skills are renamed `index.md`.
- The skills are updated by hand from upstream, like `agent-device`. Expo's
  follow the SDK, Margelo's follow the pinned library versions.
- Like ADR 0019's `OPENCODE_TEST_HOME`, `opencode/autoinvoke` is not a
  documented setting. Before upgrading OpenCode, check that a factory run's
  first request lists none of the eleven skills. If the setting is gone, the
  deny in `opencode.json` still keeps them out of the other agents' prompts,
  and only the implementer's prompt grows.
- Margelo's repository has no license file; the MMKV skill declares MIT and
  the VisionCamera skill declares none (see their `SOURCE.md`).
