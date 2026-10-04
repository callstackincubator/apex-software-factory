# OTA runbook (booth laptop)

How a merge to `main` reaches the phones at the booth, and how to run, check
and recover the pieces on the booth laptop. Decision record:
[ADR 0003](adr/0003-ota-through-self-hosted-hot-updater.md).

## What runs where

| Piece | Runs as | Port | State |
| --- | --- | --- | --- |
| MinIO (S3 API) | Docker, `infra/docker-compose.yml` | `9000`, all interfaces (phones download here) | `infra/data/minio/` |
| MinIO console | same container | `9001`, `127.0.0.1` only | — |
| `minio-init` | one-shot container on every `up` | — | creates bucket + user |
| OTA server (`@apex/ota-server`) | host Node process | `3002`, all interfaces | `apps/ota-server/data/ota.sqlite` |
| Deploy CLI (`hot-updater deploy`) | CI runner on the laptop, from `apps/mobile` | — | — |

Flow: the runner builds the JS bundle, uploads it to MinIO (`localhost:9000`)
and registers it with the OTA server's management API (`/hot-updater/api/*`,
bearer token). A phone asks the OTA server
`GET /hot-updater/fingerprint/<platform>/<fingerprint>/<channel>/<minBundleId>/<bundleId>`;
the answer is `null` (no update) or a bundle with a presigned `fileUrl`, which
the phone downloads straight from MinIO.

The OTA server runs on the host, not in Docker: better-sqlite3 is a native
module built for macOS by `pnpm install`, migrations need the repo anyway, and
one fewer image build means one fewer thing to break on the day.

## One-time setup

```sh
pnpm install
cp infra/.env.example infra/.env
cp apps/ota-server/.env.example apps/ota-server/.env
```

Fill the secrets (never commit them; `.env` files are gitignored):

- `infra/.env`: `MINIO_ROOT_PASSWORD` and `S3_SECRET_ACCESS_KEY` —
  `openssl rand -hex 24` each.
- `apps/ota-server/.env`: `HOT_UPDATER_AUTH_TOKEN` — `openssl rand -hex 32`;
  `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` — the same values as in
  `infra/.env`.
- The CI runner (and `apps/mobile/.env.hotupdater` for local deploys) needs
  `HOT_UPDATER_AUTH_TOKEN`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` with
  the same values.

Every variable is explained in the two `.env.example` files.

## Start of every booth day

```sh
open -a Docker
until docker info >/dev/null 2>&1; do sleep 2; done

docker compose -f infra/docker-compose.yml up -d   # MinIO + bucket/user init
pnpm --filter @apex/ota-server db:migrate          # idempotent
pnpm --filter @apex/ota-server start               # Ctrl-C / SIGTERM drains and exits
```

`minio-init` must end with `bucket 'hot-updater' ready; ...`:
`docker compose -f infra/docker-compose.yml logs minio-init`.

Check, from the laptop (replace the IP, see below):

```sh
curl http://192.168.1.20:3002/hot-updater/version
# {"version":"0.36.17"}
curl http://192.168.1.20:3002/hot-updater/fingerprint/ios/0000000000000000000000000000000000000000/production/00000000-0000-0000-0000-000000000000/00000000-0000-0000-0000-000000000000
# null   (no update for an unknown fingerprint)
curl -H "Authorization: Bearer $HOT_UPDATER_AUTH_TOKEN" http://192.168.1.20:3002/hot-updater/api/bundles
# {"data":[...],"pagination":{...}}   (401 without the header)
```

Then open `http://<lan-ip>:3002/hot-updater/version` in Safari/Chrome on a
booth phone. If that does not load, no OTA update will either.

End of day: stop the server (Ctrl-C), then
`docker compose -f infra/docker-compose.yml down`. Data stays in
`infra/data/` and `apps/ota-server/data/`.

## The laptop's LAN IP

```sh
ipconfig getifaddr en0   # Wi-Fi on most Macs; try en1 if empty
```

The IP is baked into the mobile release build (below), so it must not change
during the conference: give the laptop a DHCP reservation (or static IP) on
the booth router. Use a router we control — venue Wi-Fi often isolates
clients from each other, which silently breaks phone → laptop traffic.

## How download URLs reach phones

The OTA server answers update checks with an S3 URL presigned by the server.
SigV4 signs the `Host` header, so the URL must be signed for the host the phone
will call — rewriting `localhost` to the LAN IP afterwards would fail with
`403 SignatureDoesNotMatch`. Two endpoints are therefore configured:

- `S3_ENDPOINT` — how the server itself reaches MinIO (`http://127.0.0.1:9000`).
- `S3_PUBLIC_ENDPOINT` — the origin signed into `fileUrl`.
  - `auto` (default): taken from the `Host` the device used to reach the OTA
    server, with `S3_ENDPOINT`'s scheme and port. A phone that called
    `http://192.168.1.20:3002` gets `http://192.168.1.20:9000/...`; the iOS
    simulator calling `localhost` gets `localhost`. Nothing to change when
    the IP changes — only the mobile build knows it.
  - `http://<lan-ip>:9000`: pin it when devices reach the OTA server through a
    proxy or another host than MinIO.

The bucket stays private (no anonymous reads); presigned URLs are valid for
one hour, so a phone with a badly wrong clock gets `403`.

## Mobile release builds

hot-updater does not run in Expo Go or dev mode — use a release build
(`npx expo run:ios --configuration Release`, `npx expo run:android --variant release`).
What `apps/mobile` needs (owned by the mobile app, listed here for the booth):

- `HotUpdater.wrap({ baseURL: "http://<lan-ip>:3002/hot-updater", updateStrategy: "fingerprint" })`
  — take the URL from build-time config, not a literal.
- `["@hot-updater/react-native", { "channel": "production" }]` in the Expo
  plugins; the channel must match `deploy -c`.
- Plain HTTP to a LAN IP in a release build: iOS needs an App Transport
  Security exception (`NSAllowsLocalNetworking`, or `NSAllowsArbitraryLoads`
  for the booth build) and `NSLocalNetworkUsageDescription` — accept the
  "find devices on your local network" prompt on each phone. Android needs
  cleartext traffic allowed (`expo-build-properties`: `usesCleartextTraffic`).
- Before each native build: `pnpm exec hot-updater fingerprint create`, so the
  binary carries the fingerprint that OTA bundles are matched against.

## Deploying an update

The CLI config lives in `apps/mobile/hot-updater.config.ts`; the template is
[`infra/hot-updater.config.example.ts`](../../infra/hot-updater.config.example.ts)
(Expo build plugin, the same `s3Storage` as the server, `standaloneRepository`
with the bearer header, `updateStrategy: "fingerprint"`). From `apps/mobile`:

```sh
pnpm exec hot-updater deploy -p ios -c production -m "<merge commit subject>"
pnpm exec hot-updater deploy -p android -c production -m "<merge commit subject>"
```

Non-interactive unless `-i` is passed; omitting `-p` deploys iOS then Android.
`ota-publish.yml` runs this on the booth runner. If the fingerprint no longer
matches (native code changed), deploy fails — that merge needs a native build
and a reinstall, not an OTA update.

Phones pick up a normal update on the next app start; `-f` (force update)
applies it immediately.

## Rollback

From `apps/mobile` on the laptop:

```sh
pnpm exec hot-updater console        # http://localhost:1422
```

Set the bad bundle's `enabled` to off: phones running it fall back to the
previous bundle on their next check. Without the UI:

```sh
pnpm exec hot-updater bundle list -p ios
pnpm exec hot-updater bundle disable <bundle-id> -y
```

## Troubleshooting

| Symptom | Likely cause / fix |
| --- | --- |
| `docker compose up` cannot pull `minio/minio` | MinIO's images are gone from Docker Hub and gated on quay.io (Sept 2026). The compose file uses `pgsty/minio` / `pgsty/mc`; override with `MINIO_IMAGE` / `MC_IMAGE`. |
| `docker pull` hangs forever | The Docker credential helper (`docker-credential-desktop`) is stuck, e.g. on a keychain prompt. Sign in to Docker Desktop or unlock the keychain; for anonymous pulls, point `DOCKER_CONFIG` at a config without `credsStore`. |
| OTA server exits with `Invalid OTA server environment` | A variable is missing or malformed; the message names it. |
| `500` + `schema is not initialized` | Run `pnpm --filter @apex/ota-server db:migrate`. |
| Phone cannot open `http://<ip>:3002/...` | Wrong IP; laptop and phone on different networks; Wi-Fi client isolation; macOS firewall blocking `node` (System Settings → Network → Firewall). |
| Update check works, download fails | `fileUrl` host unreachable from the phone (check `S3_PUBLIC_ENDPOINT`; port 9000 blocked by the firewall for Docker); `403` = signed for another host or phone clock off. |
| `deploy` fails with `401` | `HOT_UPDATER_AUTH_TOKEN` on the runner differs from the server's. |
| `deploy` fails with `Access Denied` from S3 | `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` differ from `infra/.env`; rerun `docker compose -f infra/docker-compose.yml up -d` after changing them. |
| `EADDRINUSE` on 3002 / 9000 | Another process holds the port: `lsof -nP -iTCP:3002 -sTCP:LISTEN`. |

Full reset (deletes every deployed bundle): stop everything, remove
`infra/data/` and `apps/ota-server/data/`, then start again from the top.
