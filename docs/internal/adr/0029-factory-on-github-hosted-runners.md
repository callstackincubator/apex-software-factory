# 0029 — The factory runs on GitHub-hosted ubuntu runners

Status: Accepted

Amends [0012](0012-allow-by-default-watchdog-dispatcher.md), item 4 and its consequences.

## Context

ADR 0012 ran the dispatcher on the booth laptop's self-hosted `factory` runners, as the
maintainer's user, because the runs needed the laptop's simulator pool (ADR 0007), its native
build cache (ADR 0010) and its OpenCode login. ADR 0025 moved OTA to EAS Update, 0027 moved
lane binaries to EAS and 0028 moved devices to Expo Simulators sessions. Nothing a run needs is
on the laptop any more.

## Decision

1. **`factory.yml` runs on `ubuntu-latest`**, one fresh VM per job. Triggers, the sender check,
   the per-issue concurrency group, the app token (ADR 0020), the checkout of `main`, the
   75-minute job timeout and the watchdog of `factory-run.sh` (ADR 0012, items 1 to 3) are
   unchanged. Issues are no longer limited to two at a time.
2. **The toolchain is installed by the job**: `actions/setup-node` (`.nvmrc`),
   `pnpm/action-setup` (`packageManager`), `expo/expo-github-action` for `eas-cli` and
   `EXPO_TOKEN` (as in `ota-publish.yml`), and OpenCode pinned as the npm package
   `@opencode/cli@2.2.5`. `scripts/ci/runner-env.sh` and `prewarm.sh` are deleted.
3. **OpenCode gets its key from the secret `CALLSTACK_AI_API_KEY`.** The factory step sets
   `OPENCODE_CONFIG_CONTENT` to `{"providers":{"callstack.ai":{"settings":{"apiKey":"{env:CALLSTACK_AI_API_KEY}"}}}}`,
   which OpenCode merges over `opencode.json`. `opencode run --standalone`, which
   `factory-run.sh` uses, does not read `auth.json`: the first hosted run failed with "No api
   key passed in" when the key was written there. `opencode.json` is unchanged, so a laptop
   keeps using its own login.

## Consequences

- The agents run with `EXPO_TOKEN` and the provider key readable on a throwaway VM instead of
  the maintainer's account, with no `.env` files, device pool or personal GitHub login in
  reach. The deny list of 0012 is unchanged; the workflow must still never run a branch or a
  fork (a run that executes PR code could read both secrets).
- Runs cost GitHub Actions minutes and EAS minutes; nothing needs the booth laptop running.
- The `SIMLOCK_BIN`, `SIMLOCK_HOME` and login requirements in 0012's consequences are void.
- Workflow-level docs that still describe self-hosted runners (BOOTSTRAP sections 5, 8, 10,
  FACTORY.md) follow in the docs sweep.
