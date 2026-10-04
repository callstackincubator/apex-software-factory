#!/usr/bin/env bash
# Fails fast, with a reason a person can act on, when the booth OTA stack
# cannot take a deploy: configuration missing, OTA server down or rejecting the
# token, MinIO down or the bucket missing.
#
#   scripts/ci/ota-preflight.sh       env: HOT_UPDATER_SERVER_URL HOT_UPDATER_AUTH_TOKEN
#                                          S3_ENDPOINT S3_REGION S3_BUCKET
#                                          EXPO_PUBLIC_OTA_URL EXPO_PUBLIC_API_URL
#                                          S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY
#
# Never prints a secret: the bearer token reaches curl through its config on
# stdin, not through argv or the log.
set -euo pipefail

runbook="start the OTA stack: see docs/internal/OTA.md (Start of every booth day)"

summary() {
  [ -n "${GITHUB_STEP_SUMMARY:-}" ] && printf '%s\n' "$@" >>"$GITHUB_STEP_SUMMARY"
  return 0
}

fail() {
  local title=$1
  shift
  echo "::error title=$title::$*"
  summary "### OTA publish: preflight failed" "" "**$title.** $*" ""
  exit 1
}

missing=()
for name in HOT_UPDATER_SERVER_URL HOT_UPDATER_AUTH_TOKEN S3_ENDPOINT S3_REGION S3_BUCKET S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY EXPO_PUBLIC_OTA_URL EXPO_PUBLIC_API_URL; do
  [ -n "${!name:-}" ] || missing+=("$name")
done
[ ${#missing[@]} -eq 0 ] \
  || fail "OTA configuration missing" "Not set: ${missing[*]}. Set them as repository secrets or variables (docs/internal/DELIVERY.md, CI and OTA publishing)."

for tool in node pnpm curl; do
  command -v "$tool" >/dev/null || fail "$tool not found" "$tool is not on the runner's PATH (scripts/ci/runner-env.sh runs first)."
done

server=${HOT_UPDATER_SERVER_URL%/}
s3=${S3_ENDPOINT%/}

# 1. OTA server up: GET <server>/version answers {"version":"..."}.
if ! version=$(curl -fsS --max-time 5 "$server/version" 2>&1); then
  fail "OTA server unreachable" "GET $server/version failed ($version). $runbook."
fi
case $version in
  *'"version"'*) echo "OTA server: $version" ;;
  *) fail "OTA server answered unexpectedly" "GET $server/version returned something other than {\"version\":...}. Is HOT_UPDATER_SERVER_URL the server's /hot-updater base? $runbook." ;;
esac

# 2. Management API accepts our token (a 401 here is a 401 from deploy later).
status=$(printf 'header = "Authorization: Bearer %s"\n' "$HOT_UPDATER_AUTH_TOKEN" \
  | curl -sS -o /dev/null -w '%{http_code}' --max-time 5 -K - "$server/api/bundles" || true)
case $status in
  2??) echo "OTA management API: token accepted" ;;
  401 | 403) fail "OTA token rejected" "The management API answered $status: the HOT_UPDATER_AUTH_TOKEN secret differs from apps/ota-server/.env on the booth laptop." ;;
  *) fail "OTA management API failing" "GET $server/api/bundles answered $status. $runbook." ;;
esac

# 3. MinIO up, and the bucket exists (an anonymous request to a private bucket
#    is AccessDenied; NoSuchBucket means minio-init did not run).
if ! curl -fsS --max-time 5 -o /dev/null "$s3/minio/health/live" 2>/dev/null; then
  fail "MinIO unreachable" "GET $s3/minio/health/live failed. Is Docker running? $runbook."
fi
bucket=$(curl -sS --max-time 5 "$s3/$S3_BUCKET" 2>/dev/null || true)
case $bucket in
  *NoSuchBucket*) fail "Bucket missing" "MinIO has no bucket '$S3_BUCKET'. Rerun docker compose -f infra/docker-compose.yml up -d (minio-init creates it); $runbook." ;;
esac
echo "MinIO: up at $s3, bucket '$S3_BUCKET' present"

echo "node $(node --version), pnpm $(pnpm --version)"
summary "### OTA publish: preflight passed" "" "OTA server \`$server\` ($version), MinIO \`$s3\`, bucket \`$S3_BUCKET\`." ""
