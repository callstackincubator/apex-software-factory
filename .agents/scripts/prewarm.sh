#!/usr/bin/env bash
# Warms the booth laptop before the first visitor, so the first delivery runs as fast as the
# tenth (ADR 0010). A maintainer's script: run it from the main checkout each booth morning,
# after the OTA stack is up (docs/internal/OTA.md) and simlock's daemon is reachable.
#
#   .agents/scripts/prewarm.sh [--devices <n>] [--android] [--debug] [--metro] [--pair-phone]
#
#   1. pnpm store: `pnpm install --frozen-lockfile`, so agent worktrees install offline.
#   2. Native build cache: a Release iOS build of this checkout through device-lane.sh — a miss
#      compiles once and fills ~/.cache/apex-software-factory/native for the current
#      fingerprint; a hit takes seconds. --debug also fills the Debug build (triage, Rozenite),
#      --android the Android Release APK.
#   3. simlock pool: leases <n> iPhones at once (default 2, one per factory runner), so simlock
#      creates and boots them, and prepares agent-device's iOS runner on each (the XCUITest
#      runner is built once per Xcode version and installed per device), then releases them.
#   4. --metro: bundles the JS for both platforms once, warming Metro's transform cache for the
#      first JS swap and the first OTA deploy.
#   5. --pair-phone: prints an appduct pairing QR for a booth phone (docs/internal/OTA.md,
#      "Booth phones: appduct pairing").
#
# Needs SIMLOCK_BIN (and SIMLOCK_HOME) like the lanes, until simlock is a workspace dependency.
# Exit 0 when every step it ran passed; it keeps going after a failed step and exits 1.
set -uo pipefail

devices=2 android= debug= metro= pair=
while [ $# -gt 0 ]; do
  case $1 in
    --devices) devices=${2:?}; shift ;;
    --android) android=1 ;;
    --debug) debug=1 ;;
    --metro) metro=1 ;;
    --pair-phone) pair=1 ;;
    *) sed -n '2,25p' "$0" >&2; exit 64 ;;
  esac
  shift
done

root=$(git rev-parse --show-toplevel)
cd "$root" || exit 1
lane="$root/.agents/scripts/device-lane.sh"
export AGENT_DEVICE_NO_UPDATE_NOTIFIER=1
failed=0
t0=$(date +%s)
step() { echo; echo "== $* ($(($(date +%s) - t0))s)"; }
fail() { echo "prewarm: FAILED: $*" >&2; failed=$((failed + 1)); }

bin=$(.agents/scripts/ensure-pnpm.sh) && [ -n "$bin" ] && PATH="$bin:$PATH"

step "pnpm store"
pnpm install --frozen-lockfile >/dev/null || fail "pnpm install"

# Waits for a device-lane build log's .exit and prints its result line.
wait_build() {
  local log=$1
  until [ -f "$log.exit" ]; do sleep 5; done
  grep -E '^(build cache:|built )' "$log" | tail -n 2
  [ "$(cat "$log.exit")" = 0 ]
}

step "native build cache"
builds=("ios release")
[ -n "$debug" ] && builds+=("ios debug")
[ -n "$android" ] && builds+=("android release")
for b in "${builds[@]}"; do
  # shellcheck disable=SC2086
  log=$("$lane" build $b) && wait_build "$log" || fail "build $b (log: ${log:-none})"
done
node tools/expo-build-cache/cli.js list

if [ -n "$metro" ]; then
  step "Metro cache"
  out=$(mktemp -d)
  (cd apps/mobile && APPDUCT_ENABLED=1 pnpm exec expo export --platform ios --platform android --output-dir "$out" >/dev/null) \
    || fail "metro bundle"
  rm -rf "$out"
fi

step "simlock pool: $devices iPhone(s), agent-device runner"
simlock() {
  if [ -x "$root/node_modules/.bin/simlock" ]; then pnpm exec simlock "$@"
  elif [ -n "${SIMLOCK_BIN:-}" ]; then
    # shellcheck disable=SC2086
    $SIMLOCK_BIN "$@"
  else return 69; fi
}
warm_one() {
  local i=$1 grant id udid set
  grant=$(SIMLOCK_AGENT_ID="apex:prewarm-$i" simlock lease --platform ios --device "${APEX_DEVICE_MODEL:-iPhone 17 Pro}" \
    --detach --ttl 20m --timeout 15m --agent-id "apex:prewarm-$i" 2>&1 | grep -E '^\{' | tail -n 1)
  id=$(node -e 'try{console.log(JSON.parse(process.argv[1]).lease.id)}catch{}' "$grant")
  [ -n "$id" ] || { echo "device $i: no lease ($grant)"; return 1; }
  udid=$(node -e 'console.log(JSON.parse(process.argv[1]).device.driverDeviceId)' "$grant")
  set=$(node -e 'console.log(JSON.parse(process.argv[1]).environment?.SIMLOCK_IOS_DEVICE_SET ?? "")' "$grant")
  echo "device $i: $id $udid"
  pnpm exec agent-device prepare ios-runner --platform ios --udid "$udid" ${set:+--ios-simulator-device-set "$set"} \
    --timeout 300000 >/dev/null 2>&1 || echo "device $i: agent-device prepare ios-runner failed"
  simlock release "$id" >/dev/null 2>&1
}
if simlock status >/dev/null 2>&1; then
  pids=()
  for i in $(seq 1 "$devices"); do warm_one "$i" & pids+=($!); done
  for p in "${pids[@]}"; do wait "$p" || fail "simlock warm"; done
  simlock status 2>&1 | grep -E '^(Capacity ios|Queue)' || true
else
  fail "simlock unreachable (SIMLOCK_BIN, SIMLOCK_HOME)"
fi

if [ -n "$pair" ]; then
  step "pair a booth phone"
  echo "Scan this with the booth phone's camera (the app opens and pairs; the link works once, for 5 minutes):"
  (cd apps/mobile && pnpm exec appduct sessions link --qr) || fail "appduct sessions link --qr"
fi

step "done"
[ "$failed" -eq 0 ] || { echo "prewarm: $failed step(s) failed" >&2; exit 1; }
