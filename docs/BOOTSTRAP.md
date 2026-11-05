# Set up the factory

This page sets up the whole factory from zero: the accounts, the secrets, the
EAS project, the Cloudflare Worker, and a machine to work from. The factory
itself has no machine of its own: agents run on GitHub-hosted runners, binaries,
updates and simulator sessions are Expo's services, and the product API is a
Cloudflare Worker.

How the factory works: [FACTORY.md](FACTORY.md). The runbooks this page draws
on, with the reasons behind each step, are
[OTA.md](internal/OTA.md), [DEVICES.md](internal/DEVICES.md) and
[DELIVERY.md](internal/DELIVERY.md).

Never paste a secret into a command line, an issue or a log; the commands
below read secrets from standard input or from files.

## 1. Accounts

| Account | What for | Needs |
| --- | --- | --- |
| GitHub, `callstackincubator/apex-software-factory` | The repository, Actions, the factory GitHub App | Admin on the repository; an organization owner to create the App |
| Expo, account `callstack.io` | EAS Build, EAS Update, Expo Simulators; project `apex-factory` | The Starter plan or better, with Expo Simulators and **local egress** (experimental, per account) enabled |
| Cloudflare | The product API Worker `apex-api` | A free account |
| callstack.ai | The model, `callstack.ai/callstack/Apex` | An API key |

## 2. A machine to work from

Nothing here is needed by the factory itself; it is for people who write
specs, run OpenCode, read runs or run a lane by hand. macOS, Linux and WSL all
work. No Xcode, Android SDK or simulator is required: devices are Expo
Simulators sessions.

- Node 22.18 or newer, and pnpm through corepack (`package.json` pins the
  version in `packageManager`).
- The GitHub CLI (`gh`), logged in with write access to the repository.
- OpenCode v2 from [opencode.ai](https://opencode.ai), for the `build` and
  spec sessions, and for `check-agent-permissions.sh`.
- `eas-cli` signed in to `callstack.io` (`npx eas-cli@27.4.1 login`), for the
  one-time steps below and for running a lane by hand.
- `sqlite3` and `python3` on the `PATH` (`factory-run.sh` reads OpenCode's
  database; `worktree.sh` uses `python3`).

```bash
corepack enable
```

```bash
gh repo clone callstackincubator/apex-software-factory
```

```bash
cd apex-software-factory
```

```bash
pnpm install
```

```bash
pnpm check
```

`pnpm install` installs everything the factory runs, including agent-device
and appduct; nothing is installed globally. It also installs the lefthook git
hooks.

## 3. OpenCode

The repository's [`opencode.json`](../opencode.json) carries the whole
`callstack.ai` provider definition: base URL, limits, reasoning variants, and
the setting that keeps the model's reasoning between steps. The machine needs
only the login. On a runner the key comes from the secret
`CALLSTACK_AI_API_KEY` (section 7), written to the same file.

```bash
opencode auth login
```

Choose the `callstack.ai` provider. The login lands in
`~/.local/share/opencode/auth.json`.

Check that no agent can reach a permission prompt (it needs the login, and a
checkout that is not nested inside another one):

```bash
.agents/scripts/check-agent-permissions.sh
```

It exits 0 when no agent can reach "ask".

## 4. The EAS project

The project is `apex-factory` in the `callstack.io` account; its id is in
[`apps/mobile/app.json`](../apps/mobile/app.json) (`updates.url`). If you are
recreating it, create the project in the Expo dashboard and put its id in
`updates.url`; a change to `app.json` is a native change, so it needs new
`production` builds.

**The robot.** The factory acts on EAS as a robot user, not as a person. In
the `callstack.io` account's settings (Access), create a robot with the
**Developer** role and an access token for it, then store the token as the
repository secret `EXPO_TOKEN`. `gh secret set NAME` reads the value from
standard input, so it never appears in the terminal or the shell history:

```bash
gh secret set EXPO_TOKEN
```

**The environments.** `EXPO_PUBLIC_API_URL` lives in the EAS environments
`production` (the `production` profile and `eas update`) and `preview` (the
`lane` profile). Both hold the Worker's address (section 5), so binaries and
updates carry the same value:

```bash
(cd apps/mobile && eas env:set --name EXPO_PUBLIC_API_URL --value "https://apex-api.szymonchmal.workers.dev" --environment production --visibility plaintext && eas env:set --name EXPO_PUBLIC_API_URL --value "https://apex-api.szymonchmal.workers.dev" --environment preview --visibility plaintext)
```

**The channels.** `production` and `lane` ([OTA.md, One-time
setup](internal/OTA.md#one-time-setup)):

```bash
(cd apps/mobile && eas channel:create production && eas channel:create lane)
```

**The binaries.** Updates reach only binaries built with the same native
fingerprint, and lanes repack a `production` build, so build one for each
platform from `main`:

```bash
(cd apps/mobile && eas build --profile production --platform all --non-interactive)
```

Both are simulator and APK builds; there is no phone to sign for
([OTA.md, Production builds](internal/OTA.md#production-builds)). Build again
after any native change, including an edit to `eas.json`.

## 5. The product API

In production the API is a Cloudflare Worker named `apex-api` on the free plan,
at `https://apex-api.szymonchmal.workers.dev` (ADR 0026), deployed by
`.github/workflows/api-deploy.yml` on every merge to `main` that touches the
API. A pull request uploads a version under the alias `pr-<number>` and the
workflow comments the preview URL. One-time setup:

1. In the Cloudflare dashboard, note the Account ID (Workers & Pages).
2. Create an API token from the "Edit Cloudflare Workers" template (My
   Profile, API Tokens), limited to that account.
3. Store both as repository secrets:

   ```bash
   gh secret set CLOUDFLARE_API_TOKEN
   ```

   ```bash
   gh secret set CLOUDFLARE_ACCOUNT_ID
   ```

4. First deploy, by hand, from `apps/api`: `pnpm exec wrangler login`, then
   `pnpm run deploy` (plain `pnpm deploy` is pnpm's own command). It
   registers the account's `workers.dev` subdomain, which is part of the
   address in section 4.

To run the API locally on Node:

```bash
pnpm --filter @apex/api start
```

The app works without the API; its status footer then says "offline".

## 6. The GitHub App

Unattended runs act on GitHub as the factory's GitHub App (ADR 0020). It
belongs to the repository. If `FACTORY_APP_ID` and `FACTORY_APP_PRIVATE_KEY`
are missing from the secret list, an organization owner creates the app:

- No webhook.
- Repository permissions: Contents, Issues and Pull requests read and write;
  Actions, Checks and Commit statuses read. Metadata is always read.
- Not Workflows: an unattended run must not change `.github/workflows/`
  (safety rule 6).
- Installed on this repository only.

Then store its ID and a private key it generated:

```bash
printf '%s' "<app id>" | gh secret set FACTORY_APP_ID
```

```bash
gh secret set FACTORY_APP_PRIVATE_KEY < "<path to the downloaded .pem>"
```

Delete the downloaded `.pem` afterwards: each factory job mints a one-hour
token from the secrets.

## 7. The remaining secrets and a check

The model key, which the factory job writes to OpenCode's `auth.json` and then
unsets (ADR 0029):

```bash
gh secret set CALLSTACK_AI_API_KEY
```

The full list, and what reads each: [DELIVERY.md, OTA
publish](internal/DELIVERY.md#ci-and-ota-publishing).

| Secret | Read by |
| --- | --- |
| `EXPO_TOKEN` | `factory.yml` (lanes), `ota-publish.yml` |
| `CALLSTACK_AI_API_KEY` | `factory.yml` |
| `FACTORY_APP_ID`, `FACTORY_APP_PRIVATE_KEY` | `factory.yml`, `issue-state.yml` |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | `api-deploy.yml` |

Check the names (values are never shown):

```bash
gh secret list
```

Then run the OTA publish in preflight mode. It prints the fingerprints, looks
for their `production` builds on EAS, and publishes nothing:

```bash
gh workflow run ota-publish.yml -f preflight_only=true
```

```bash
gh run watch "$(gh run list --workflow ota-publish.yml --limit 1 --json databaseId -q '.[0].databaseId')"
```

It must find a build for both platforms. And a lane, from a checkout signed in
to EAS, shows that Expo Simulators and the egress tunnel work:

```bash
.agents/scripts/device-lane.sh lease ios --production
```

```bash
.agents/scripts/device-lane.sh release
```

## 8. Check the model keeps its reasoning

The model's endpoint reads earlier reasoning only from the `reasoning` field.
`opencode.json` sets `"compatibility": { "reasoningField": "reasoning" }` so
OpenCode sends it there. If the endpoint or OpenCode changes, each step would
plan from scratch again and runs get slow. Check it on a new machine, after an
OpenCode upgrade, and when runs suddenly take much longer.

When reasoning is kept, a step's prompt (`tokens.input + tokens.cache.read`)
is larger than the previous step's by at least that step's reasoning
(`tokens.reasoning`). When it is dropped, the prompt grows only by the output
and tool results.

Run any session with a few steps first, for example a short factory run, or:

```bash
opencode run "Read AGENTS.md, then read two of the skills it lists, and say in one sentence what each does."
```

Then list the newest session with at least five steps:

```bash
set -o pipefail
sqlite3 -json -readonly ~/.local/share/opencode/opencode.db "
  select json_extract(data, '$.tokens.input') + json_extract(data, '$.tokens.cache.read') as prompt,
         json_extract(data, '$.tokens.reasoning') as reasoning
  from session_message
  where type = 'assistant'
    and session_id = (select session_id from session_message where type = 'assistant'
                      group by session_id having count(*) >= 5
                      order by max(time_created) desc limit 1)
  order by seq" |
  node -e '
    const rows = JSON.parse(require("fs").readFileSync(0, "utf8") || "[]");
    for (let i = 1; i < rows.length; i++) {
      const grew = rows[i].prompt - rows[i - 1].prompt;
      const thought = rows[i - 1].reasoning;
      let verdict = "";
      if (grew < 0) verdict = "(prompt shrank: compaction, skip)";
      else if (thought >= 500) verdict = grew >= 0.8 * thought ? "kept" : "DROPPED";
      console.log(`step ${i + 1}: prompt +${grew}, step ${i} reasoned ${thought} ${verdict}`);
    }'
```

Only steps after one that reasoned 500 tokens or more get a verdict. Output
from a healthy session:

```
step 10: prompt +3625, step 9 reasoned 2722 kept
step 11: prompt +1722, step 10 reasoned 1409 kept
```

Mostly `kept`: fine. Mostly `DROPPED`: the endpoint ignores the field. Read
[ADR 0014](internal/adr/0014-keep-the-models-reasoning-between-steps.md) and
update the setting in `opencode.json`.

## 9. Smoke test

Prove the whole line: a label starts a run on a GitHub runner, the run merges,
the OTA publish ships, a binary shows the banner.

1. Write a tiny one-PR feature from
   [the booth feature template](internal/templates/booth-feature.md). Pick
   something you are happy to keep in the app, for example a "Shipped at the
   booth" entry. Save the body to a file, then file it:

   ```bash
   gh issue create --title "<short title>" --label feature:spec --body-file <file>
   ```

   Or let the tools write it: `/spec <n> technical` in OpenCode ends with the
   spec checker.

2. Sign it. This starts the run:

   ```bash
   gh issue edit <n> --add-label feature:ready
   ```

3. Watch it ([FACTORY.md, You want to watch a run](FACTORY.md#you-want-to-watch-a-run)):

   ```bash
   gh run list --workflow factory.yml --limit 3
   ```

4. After the merge, watch the publish:

   ```bash
   gh run list --workflow ota-publish.yml --limit 3
   ```

   The run's `ota-verifier` checks that a `production` binary in a simulator
   session takes the update. To see it yourself, lease one, open the app and
   wait for the banner "New feature landed — tap to reload" (it checks every 30
   seconds):

   ```bash
   .agents/scripts/device-lane.sh lease ios --production
   ```

   ```bash
   .agents/scripts/device-lane.sh screenshot banner
   ```

   ```bash
   .agents/scripts/device-lane.sh release
   ```

The run ends with a `## Delivery run` comment on the issue, posted by the
factory app's bot (`<app slug>[bot]`), which also authored the PR and its
commits. A parked run leaves a `## Handoff` comment instead; see
[FACTORY.md, What to do when…](FACTORY.md#what-to-do-when).

To take a test feature out of the app, a maintainer disables its bundle
([OTA.md, Rollback](internal/OTA.md#rollback)) and reverts the PR.

## 10. Leftovers from the booth laptop

The factory used to run on a Mac at the booth. If one is still registered,
remove what it left:

```bash
gh api repos/callstackincubator/apex-software-factory/actions/runners -q '.runners[] | "\(.id) \(.name) \(.status)"'
```

Delete each self-hosted runner listed (`gh api -X DELETE repos/callstackincubator/apex-software-factory/actions/runners/<id>`), and
the old secrets and variables that no workflow reads any more (the OTA token,
S3 credentials, the LAN address):

```bash
gh secret list && gh variable list
```

On the old machine, stop the runner services and delete the OTA and MinIO data
and `.env` files; nothing in them is needed any more.
