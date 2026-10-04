#!/usr/bin/env bash
# Deploys the mobile JS bundle over the air, both platforms at once, and says
# per platform whether it shipped, needs a native build, or failed.
#
#   scripts/ci/ota-deploy.sh
#
# env: OTA_MESSAGE (required), OTA_CHANNEL (default production),
#      OTA_PLATFORMS (default "ios android"), plus the hot-updater variables the
#      deploy reads (HOT_UPDATER_SERVER_URL, HOT_UPDATER_AUTH_TOKEN, S3_*).
#      OTA_MISMATCH_PATTERN overrides the extended regex that recognises a
#      fingerprint mismatch in the deploy output. APPDUCT_ENABLED is forced
#      to 1 and WITH_ROZENITE unset (the booth binary's build profile).
#
# Outputs ($GITHUB_OUTPUT): result=shipped|needs-native-build|failed, and
# <platform>_status / <platform>_bundle for each platform. Exit 0 only when
# every platform shipped. Platforms are independent (each has its own native
# fingerprint), so a mismatch on one does not stop the other.
#
# Production is deployed only from main by this workflow (safety rule 5); the
# fingerprint strategy is never bypassed (safety rule 4): no -f, no forced
# fingerprint, no app-version override.
set -uo pipefail

: "${OTA_MESSAGE:?OTA_MESSAGE is required}"
channel=${OTA_CHANNEL:-production}
platforms=${OTA_PLATFORMS:-ios android}
# hot-updater 0.36: "Fingerprint mismatch.", "Fingerprint.json not found",
# "Fingerprint hash not found"; plus wording a wrapper script may add.
pattern=${OTA_MISMATCH_PATTERN:-'fingerprint (mismatch|hash not found|does not match|doesn.t match)|fingerprint\.json not found|needs? a native build|native build (is )?required|no (registered|matching) native build'}
logs=${RUNNER_TEMP:-$(mktemp -d)}

# The booth binary's build profile: appduct linked (it changes the iOS
# fingerprint), Rozenite off. The ota:deploy script sets APPDUCT_ENABLED too;
# setting it here keeps a manual run of this script on the same profile.
export APPDUCT_ENABLED=1
unset WITH_ROZENITE

output() { [ -n "${GITHUB_OUTPUT:-}" ] && echo "$1=$2" >>"$GITHUB_OUTPUT"; return 0; }

# Both platforms deploy at the same time: each has its own fingerprint, its own bundle
# directory (hot-updater.config.ts: dist/<platform>) and its own archive directory (-o), so
# neither waits for the other. Logs are printed per platform once both finish.
deploy_one() {
  local platform=$1 log=$2
  pnpm --filter @apex/mobile run ota:deploy -p "$platform" -c "$channel" -m "$OTA_MESSAGE" \
    -o ".hot-updater/output-$platform" >"$log" 2>&1
  echo $? >"$log.exit"
}

for platform in $platforms; do
  rm -f "$logs/ota-deploy-$platform.log.exit"
  # Options go straight after the script name: pnpm forwards them as they are,
  # whereas a literal "--" would reach the script and end its option parsing.
  deploy_one "$platform" "$logs/ota-deploy-$platform.log" &
done
wait

shipped=0 native=0 failed=0
for platform in $platforms; do
  log="$logs/ota-deploy-$platform.log"
  code=$(cat "$log.exit" 2>/dev/null || echo 1)
  echo "::group::Deploy $platform to $channel (exit $code)"
  cat "$log"
  echo "::endgroup::"

  # Strip ANSI colours before matching.
  plain=$(sed -E $'s/\x1b\\[[0-9;]*[A-Za-z]//g' "$log")
  if [ "$code" -eq 0 ]; then
    bundle=$(printf '%s\n' "$plain" | grep -oE 'Deployment Successful \([0-9a-fA-F-]{36}\)' | tail -1 | grep -oE '[0-9a-fA-F-]{36}' || true)
    status=shipped
    shipped=$((shipped + 1))
    echo "$platform: shipped ${bundle:-"(bundle id not found in the output)"}"
  elif printf '%s\n' "$plain" | grep -qiE "$pattern"; then
    bundle=
    status=needs-native-build
    native=$((native + 1))
    echo "::error title=$platform needs a native build::The native fingerprint does not match a registered native build. Not shipped over the air."
  else
    bundle=
    status=failed
    failed=$((failed + 1))
    echo "::error title=$platform deploy failed::ota:deploy exited $code; see the log above. docs/internal/OTA.md, Troubleshooting."
  fi
  output "${platform}_status" "$status"
  output "${platform}_bundle" "$bundle"
done

if [ "$failed" -gt 0 ]; then
  output result failed
  exit 1
elif [ "$native" -gt 0 ]; then
  output result needs-native-build
  exit 1
fi
output result shipped
echo "shipped $shipped platform(s) to $channel"
