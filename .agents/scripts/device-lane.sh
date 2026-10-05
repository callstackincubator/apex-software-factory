#!/usr/bin/env sh
# One device lane per worktree: a simulator or emulator leased from simlock, driven with
# agent-device, shortcut with appduct, debugged with Rozenite. Skills call only this script;
# it calls only `simlock`, `pnpm exec {agent-device,appduct,rozenite}`, expo, xcodebuild and
# gradle — never raw simctl or adb (ADR 0007, delivery rule 16).
#
#   device-lane.sh lease <ios|android> [model]  lease a device for this lane (default model:
#                                               "iPhone 17 Pro" / "Pixel 8"); waits in simlock's
#                                               queue up to APEX_LEASE_WAIT seconds per call (540)
#   device-lane.sh build <ios|android> <release|debug>
#                                               detached build of this worktree's app, prints the
#                                               log path; <log>.exit and <log>.artifact appear
#                                               when it ends. Needs no lease. A cached binary with
#                                               the same native fingerprint is reused (JS swapped
#                                               in for release) instead of compiling: seconds,
#                                               not minutes (tools/expo-build-cache). A lane
#                                               binary takes no OTA update unless
#                                               APEX_LANE_OTA=on (the OTA check sets it).
#   device-lane.sh install [path]               install the last successful build on the device
#   device-lane.sh metro <start|stop>           Metro for a debug build (WITH_ROZENITE=true,
#                                               APPDUCT_ENABLED=1) on this lane's own port
#   device-lane.sh ad <agent-device args...>    agent-device, pinned to the leased device and the
#                                               lane's session (apex-<branch>)
#   device-lane.sh appduct link | ls [args] | describe <tool> | call <tool> [json]
#                         | events <ls|since> [args] | sessions
#                                               appduct: link pairs the running app through
#                                               agent-device; the rest use the lane's session id
#   device-lane.sh rozenite targets | session | reset | <domain> <args...>
#                                               rozenite agent against the lane's Metro port
#   device-lane.sh screenshot <name>            <main checkout>/.worktrees/sim-shots/<name>.png
#   device-lane.sh renew                        push the lease's deadline out by its TTL
#   device-lane.sh status                       this lane, simlock's queue, the build slots
#   device-lane.sh release                      metro stop, agent-device close, simlock release;
#                                               without a lease, closes the lane's leftover
#                                               agent-device session (frees a stale device)
#
# Exit codes: 0 done; 1 failed; 2 still queued for a device (run `lease` again to keep
# waiting); 64 usage; 69 unavailable (this machine cannot do it: no simlock, no Xcode, no
# runtime for that model; nothing is ever installed to make it possible); 75 busy (simlock
# found no device within APEX_LEASE_TIMEOUT, default 30m); 76 an `ad` command failed twice on the
# device side (CoreSimulator or the XCUITest runner, not the app: retried once already).
#
# Lane identity: the worktree's branch. simlock requester `apex:<branch>` (one lease per lane),
# agent-device session `apex-<branch>`. State lives in <worktree>/.apex/ (gitignored):
# device.json (the lease, Metro, appduct and Rozenite sessions), logs/, artifact-<platform>.
#
# A lease is detached with a TTL (APEX_LEASE_TTL, default 60m), renewed by every call that uses
# the device once half of it has passed; the TTL is the backstop when an agent dies without
# `release`. Builds hold no lease. They wait for one of APEX_BUILD_SLOTS (default 1) machine-
# wide build slots (/tmp/apex-build.lock.<n>), so two lanes never run xcodebuild at once
# unless the maintainer raises it. A slot whose owner died is taken over.
#
# The simlock CLI: `pnpm exec simlock` when the workspace has it, else $SIMLOCK_BIN, a command
# line such as "node /path/to/simlock/dist/cli/main.js", set in the environment OpenCode runs
# in (`opencode run --standalone` inherits the caller's; the background service keeps the one
# it started with). SIMLOCK_HOME, when set, moves simlock's state and devices; keep it short.
# simlock 0.3.0 keeps its simulators in its own device set; the grant's SIMLOCK_IOS_DEVICE_SET
# (or ANDROID_ADB_SERVER_PORT) is passed to every agent-device call. A grant without one
# (simlock 0.2.0) uses the default set.
#
# Known gaps it works around (agent-device 0.21.20): `replay` and `test` lose the device set,
# so replays run inside the lane's session and `ad test` replays scripts one by one; iOS's
# "Open in Apex Factory?" prompt for a deep link into a running app is accepted here.
set -eu

usage() {
  sed -n '2,/^# Exit codes/p' "$self" | sed '$d' | sed 's/^# \{0,1\}//' >&2
  exit 64
}

die() {
  echo "$*" >&2
  exit 1
}

unavailable() {
  echo "unavailable: $*" >&2
  exit 69
}

self="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
root=$(git rev-parse --show-toplevel 2>/dev/null) || die "not inside a git worktree"
main_root=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
cd "$root"

branch=$(git rev-parse --abbrev-ref HEAD)
[ "$branch" = HEAD ] && branch=$(basename "$root")
lane=$(printf '%s' "$branch" | tr -c 'A-Za-z0-9._-' '-')
agent_id="apex:$branch"
session="apex-$lane"
app_id=${APEX_APP_ID:-com.callstack.apexfactory}
state_dir="$root/.apex"
state="$state_dir/device.json"
mobile="$root/apps/mobile"

export AGENT_DEVICE_NO_UPDATE_NOTIFIER=1

# ---------------------------------------------------------------------------------------------
# State: a flat JSON object in .apex/device.json.

state_get() {
  [ -f "$state" ] || return 0
  node -e '
    const s = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const v = s[process.argv[2]];
    if (v !== undefined && v !== null) console.log(v);
  ' "$state" "$1"
}

# state_set key value [key value]...; an empty value deletes the key.
state_set() {
  mkdir -p "$state_dir"
  node -e '
    const fs = require("fs");
    const [file, ...kv] = process.argv.slice(1);
    const s = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
    for (let i = 0; i < kv.length; i += 2) {
      if (kv[i + 1] === "") delete s[kv[i]];
      else s[kv[i]] = /^\d+$/.test(kv[i + 1]) ? Number(kv[i + 1]) : kv[i + 1];
    }
    fs.writeFileSync(file, JSON.stringify(s, null, 2) + "\n");
  ' "$state" "$@"
}

# json_field <json> <path.to.field>: prints the field, or nothing.
json_field() {
  node -e '
    let v; try { v = JSON.parse(process.argv[1]); } catch { process.exit(0); }
    for (const k of process.argv[2].split(".")) v = v == null ? undefined : v[k];
    if (v !== undefined && v !== null) console.log(typeof v === "object" ? JSON.stringify(v) : v);
  ' "$1" "$2"
}

# ---------------------------------------------------------------------------------------------
# Tools.

have_simlock() {
  [ -x "$root/node_modules/.bin/simlock" ] || [ -n "${SIMLOCK_BIN:-}" ]
}

simlock() {
  if [ -x "$root/node_modules/.bin/simlock" ]; then
    pnpm exec simlock "$@"
  elif [ -n "${SIMLOCK_BIN:-}" ]; then
    # SIMLOCK_BIN is a command line; split it on purpose.
    # shellcheck disable=SC2086
    $SIMLOCK_BIN "$@"
  else
    unavailable "no simlock CLI: add it to the workspace, or set SIMLOCK_BIN"
  fi
}

require_lease() {
  [ -f "$state" ] && [ -n "$(state_get leaseId)" ] \
    || die "no lease for lane $agent_id: run .agents/scripts/device-lane.sh lease ios first"
}

# Runs agent-device pinned to the leased device. Callers pass the command and its arguments.
agent_device() {
  platform=$(state_get platform)
  device=$(state_get device)
  set_path=$(state_get deviceSet)
  adb_port=$(state_get adbPort)
  if [ "$platform" = android ]; then
    if [ -n "$adb_port" ]; then
      ANDROID_ADB_SERVER_PORT=$adb_port AGENT_DEVICE_STATE_DIR="${AGENT_DEVICE_SIMLOCK_STATE_DIR:-$HOME/.agent-device-simlock}" \
        pnpm exec agent-device "$@" --platform android --serial "$device" --session "$session"
    else
      pnpm exec agent-device "$@" --platform android --serial "$device" --session "$session"
    fi
  elif [ -n "$set_path" ]; then
    pnpm exec agent-device "$@" --platform ios --udid "$device" --ios-simulator-device-set "$set_path" --session "$session"
  else
    pnpm exec agent-device "$@" --platform ios --udid "$device" --session "$session"
  fi
}

# Renews the lease once half its TTL has passed, so a long dev loop keeps its device.
renew_if_due() {
  deadline=$(state_get ttlDeadline)
  ttl=$(state_get ttlMs)
  [ -n "$deadline" ] && [ -n "$ttl" ] || return 0
  now=$(($(date +%s) * 1000))
  [ $((deadline - now)) -lt $((ttl / 2)) ] || return 0
  renew_lease >/dev/null
}

renew_lease() {
  id=$(state_get leaseId)
  out=$(simlock lease renew "$id" 2>&1) || {
    echo "$out" >&2
    die "lease $id could not be renewed (expired or released); lease again"
  }
  state_set ttlDeadline "$(json_field "$out" ttlDeadline)"
  echo "renewed $id until $(date -r $(($(json_field "$out" ttlDeadline) / 1000)) +%H:%M:%S)"
}

# Detaches a command from the calling shell, so no tool time limit kills it halfway:
#   detach <log> [--out <file>] <command...>
# stdout and stderr go to <log> (stdout to <file> with --out); <log>.pid is written before this
# returns; <log>.exit holds the exit code once the command ends.
detach() {
  log=$1
  shift
  out=$log
  if [ "${1:-}" = --out ]; then
    out=$2
    shift 2
  fi
  mkdir -p "$(dirname "$log")"
  rm -f "$log.exit"
  python3 - "$log" "$out" "$root" "$@" <<'EOF'
import os, subprocess, sys
log, out, cwd, argv = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4:]
child = os.fork()
if child != 0:
    with open(log + ".pid", "w") as f:
        f.write(str(child))
    sys.exit(0)
os.setsid()
null = os.open(os.devnull, os.O_RDWR)
for fd in (0, 1, 2):
    os.dup2(null, fd)
with open(log, "a") as err, open(out, "a") as std:
    try:
        code = subprocess.call(argv, cwd=cwd, stdout=std, stderr=err, stdin=subprocess.DEVNULL)
    except OSError as e:
        err.write(f"could not start {argv[0]}: {e}\n")
        code = 127
with open(log + ".exit", "w") as f:
    f.write(f"{code}\n")
EOF
}

alive() { [ -n "${1:-}" ] && kill -0 "$1" 2>/dev/null; }

# ---------------------------------------------------------------------------------------------
# lease

write_grant() {
  grant=$1
  platform=$2
  id=$(json_field "$grant" lease.id)
  [ -n "$id" ] || die "simlock answered without a lease: $grant"
  # Until the lane's state names the lease, a failure here must not strand the device.
  trap 'simlock release "$id" >/dev/null 2>&1 || true' EXIT
  # What agent-device drives: the simulator's UDID (driverDeviceId) on iOS; on Android the
  # emulator's adb serial, which simlock reports as the device's address (its driverDeviceId
  # there is the AVD name, which no adb command accepts).
  device=$(json_field "$grant" device.driverDeviceId)
  if [ "$platform" = android ]; then
    address=$(json_field "$grant" device.address)
    [ -n "$address" ] || die "simlock granted an Android device without an adb serial: $grant"
    device=$address
  fi
  state_set \
    platform "$platform" \
    leaseId "$id" \
    agentId "$agent_id" \
    session "$session" \
    device "$device" \
    model "$(json_field "$grant" device.spec.model)" \
    os "$(json_field "$grant" device.spec.osVersion)" \
    mode "$(json_field "$grant" device.mode)" \
    deviceSet "$(json_field "$grant" environment.SIMLOCK_IOS_DEVICE_SET)" \
    adbPort "$(json_field "$grant" environment.ANDROID_ADB_SERVER_PORT)" \
    ttlMs "$(json_field "$grant" lease.ttlMs)" \
    ttlDeadline "$(json_field "$grant" lease.ttlDeadline)"
  trap - EXIT
  # The lane's agent-device session name is reused across leases; one left over from a lease
  # that died (or another device) would refuse this device ("owned by session"). Close it.
  close_stale_session
}

# Closes this lane's agent-device session wherever it is, without needing a lease: the way to
# free a device agent-device still thinks this lane holds after a crash.
close_stale_session() {
  pnpm exec agent-device close --session "$session" >/dev/null 2>&1 || true
  [ -z "${AGENT_DEVICE_SIMLOCK_STATE_DIR:-}" ] \
    || AGENT_DEVICE_STATE_DIR=$AGENT_DEVICE_SIMLOCK_STATE_DIR pnpm exec agent-device close --session "$session" >/dev/null 2>&1 || true
}

lease_summary() {
  echo "leased: $(state_get leaseId) $(state_get model) $(state_get os) ($(state_get mode)) $(state_get device) for $agent_id until $(date -r $(($(state_get ttlDeadline) / 1000)) +%H:%M:%S)"
}

cmd_lease() {
  platform=${1:?usage: device-lane.sh lease <ios|android> [model]}
  case $platform in
    ios)
      [ "$(uname -s)" = Darwin ] || unavailable "the iOS simulator needs macOS"
      command -v xcrun >/dev/null 2>&1 || unavailable "xcrun not found (Xcode command line tools)"
      model=${2:-${APEX_DEVICE_MODEL:-iPhone 17 Pro}}
      ;;
    android) model=${2:-${APEX_DEVICE_MODEL:-Pixel 8}} ;;
    *) usage ;;
  esac
  have_simlock || unavailable "no simlock CLI: add it to the workspace, or set SIMLOCK_BIN"

  # Already leased: keep it when simlock still has it.
  if [ -n "$(state_get leaseId)" ]; then
    if renew_lease >/dev/null 2>&1; then
      [ "$(state_get platform)" = "$platform" ] || die "this lane already holds a $(state_get platform) lease; release it first"
      lease_summary
      return 0
    fi
    echo "the lane's lease $(state_get leaseId) is gone; leasing again" >&2
    rm -f "$state"
  fi

  req="$state_dir/lease-request"
  pid=$(cat "$req.log.pid" 2>/dev/null || true)
  if ! alive "$pid" && [ ! -f "$req.log.exit" ]; then
    rm -f "$req.out" "$req.log" "$req.log.pid"
    echo "$platform" >"$req.platform"
    set -- lease --platform "$platform" --device "$model" --detach \
      --ttl "${APEX_LEASE_TTL:-60m}" --timeout "${APEX_LEASE_TIMEOUT:-30m}" --agent-id "$agent_id"
    [ -n "${APEX_DEVICE_OS:-}" ] && set -- "$@" --os "$APEX_DEVICE_OS"
    [ -n "${APEX_DEVICE_MODE:-}" ] && set -- "$@" --mode "$APEX_DEVICE_MODE"
    if [ -x "$root/node_modules/.bin/simlock" ]; then
      set -- pnpm exec simlock "$@"
    else
      # shellcheck disable=SC2086
      set -- $SIMLOCK_BIN "$@"
    fi
    detach "$req.log" --out "$req.out" env SIMLOCK_AGENT_ID="$agent_id" "$@"
    echo "requested a $model ($platform) for $agent_id" >&2
  fi
  platform=$(cat "$req.platform")

  waited=0
  limit=${APEX_LEASE_WAIT:-540}
  while [ ! -f "$req.log.exit" ]; do
    if [ "$waited" -ge "$limit" ]; then
      echo "queued: $(grep '"stage"' "$req.log" 2>/dev/null | tail -n 1 || echo 'waiting for simlock')" >&2
      echo "still waiting for a device; run 'device-lane.sh lease $platform' again to keep waiting" >&2
      exit 2
    fi
    sleep 3
    waited=$((waited + 3))
  done

  code=$(cat "$req.log.exit")
  grant=$(tail -n 1 "$req.out" 2>/dev/null || true)
  err=$(grep '"error"' "$req.log" 2>/dev/null | tail -n 1 || true)
  rm -f "$req.out" "$req.log.pid" "$req.log.exit" "$req.platform"
  case $code in
    0)
      write_grant "$grant" "$platform"
      rm -f "$req.log"
      lease_summary
      ;;
    10 | 11)
      echo "busy: no $platform device for $agent_id within ${APEX_LEASE_TIMEOUT:-30m} ($err)" >&2
      exit 75
      ;;
    12) unavailable "simlock cannot provide that device: $err" ;;
    13)
      # The lane lost its state but simlock still holds a lease for its requester id, which
      # only this worktree uses. Give it back and ask again.
      old=$(printf '%s\n' "$err" | grep -oE 'lse_[A-Za-z0-9_-]+' | head -n 1)
      [ -n "$old" ] || die "simlock: $err"
      echo "releasing the lane's orphaned lease $old" >&2
      simlock release "$old" >/dev/null
      exec "$self" lease "$platform" "$model"
      ;;
    *) die "simlock lease failed (exit $code): $err" ;;
  esac
}

# ---------------------------------------------------------------------------------------------
# build

acquire_build_slot() {
  slots=${APEX_BUILD_SLOTS:-1}
  base=${APEX_BUILD_LOCK:-/tmp/apex-build.lock}
  deadline=$(($(date +%s) + ${APEX_BUILD_WAIT:-3600}))
  said=0
  while :; do
    i=1
    while [ "$i" -le "$slots" ]; do
      lock="$base.$i"
      if mkdir "$lock" 2>/dev/null; then
        echo $$ >"$lock/pid"
        echo "$root" >"$lock/root"
        echo "$1" >"$lock/log"
        slot=$lock
        return 0
      fi
      pid=$(cat "$lock/pid" 2>/dev/null || true)
      # No pid yet means its owner is still starting, unless that was long ago.
      if { [ -n "$pid" ] && ! alive "$pid"; } \
        || { [ -z "$pid" ] && [ -z "$(find "$lock" -maxdepth 0 -mmin -1)" ]; }; then
        rm -rf "$lock"
        continue
      fi
      i=$((i + 1))
    done
    [ "$(date +%s)" -lt "$deadline" ] || {
      echo "busy: no build slot within ${APEX_BUILD_WAIT:-3600}s"
      exit 75
    }
    if [ $((said % 20)) -eq 0 ]; then
      echo "waiting for a build slot: $(for l in "$base".*; do printf '%s ' "$(cat "$l/root" 2>/dev/null)"; done)"
    fi
    said=$((said + 1))
    sleep 3
  done
}

# Runs detached, output in the log (see cmd_build).
build_job() {
  platform=$1
  profile=$2
  log=$3
  started=$(date +%s)
  # The native build cache (tools/expo-build-cache, ADR 0010), shared with `expo run`: keyed by
  # the OTA fingerprint, so a JS-only change installs a cached binary with this checkout's JS
  # swapped in instead of compiling native code. A miss builds and fills the cache.
  # APEX_BUILD_CACHE=0 always builds.
  cache_cli="$root/tools/expo-build-cache/cli.js"
  native_fp=
  if [ "${APEX_BUILD_CACHE:-1}" != 0 ] && [ -f "$cache_cli" ]; then
    if native_fp=$(node "$cache_cli" fingerprint "$platform" "$mobile"); then
      echo "native fingerprint ($platform): $native_fp"
      if artifact=$(node "$cache_cli" resolve "$platform" "$profile" "$mobile" "$native_fp" "$state_dir/build-cache/$platform-$profile"); then
        echo "$artifact" >"$log.artifact"
        echo "$artifact" >"$state_dir/artifact-$platform"
        echo "build cache: hit, no native build ($(($(date +%s) - started))s)"
        echo "built $artifact"
        return 0
      fi
      echo "build cache: miss for $platform $profile $native_fp; building"
    else
      native_fp=
      echo "build cache: no fingerprint; building without the cache"
    fi
  fi
  acquire_build_slot "$log"
  # Prebuild rewrites apps/mobile/fingerprint.json for the binary it describes. That file is
  # committed only with a native change (ADR 0003), so a lane build puts a clean one back.
  fp=apps/mobile/fingerprint.json
  if git diff --quiet -- "$fp" 2>/dev/null; then restore_fp=1; else restore_fp=; fi
  trap 'rm -rf "$slot"; [ -z "$restore_fp" ] || git -C "$root" checkout -q -- "$fp"' EXIT
  trap 'exit 143' INT TERM
  echo "build slot $slot; $platform $profile of $root at $(git rev-parse --short HEAD)"
  case $profile in release) config=Release ;; debug) config=Debug ;; esac
  cd "$mobile"
  # One build profile for every binary (ADR 0007): appduct is linked in Debug and Release.
  export APPDUCT_ENABLED=1 LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8
  # Precompiled Expo Modules (on by default since SDK 56) keep a cold iOS build short; nothing
  # in a lane may turn them off.
  unset WITH_ROZENITE EXPO_USE_PRECOMPILED_MODULES
  # A lane binary takes no OTA update unless APEX_LANE_OTA=on (the OTA check): its embedded JS
  # talks to an OTA URL nothing listens on, so a check always runs the JS under test.
  if [ "${APEX_LANE_OTA:-off}" != on ] && [ "$profile" = release ]; then
    EXPO_PUBLIC_OTA_URL=$(node -p 'require(process.argv[1]).OTA_OFF_URL' "$root/tools/expo-build-cache/lib.js")
    export EXPO_PUBLIC_OTA_URL
  fi
  case $platform in
    ios)
      pnpm exec expo prebuild --platform ios --no-install
      (cd ios && pod install)
      ws=$(ls -d ios/*.xcworkspace | head -n 1)
      name=$(basename "$ws" .xcworkspace)
      # A generic destination fits any simulator, so the device can be leased after the build
      # starts; ARCHS keeps it to this Mac's architecture. -quiet leaves warnings and errors.
      xcodebuild -quiet -workspace "$ws" -scheme "$name" -configuration "$config" -sdk iphonesimulator \
        -destination 'generic/platform=iOS Simulator' -derivedDataPath build/ios \
        ARCHS="$(uname -m)" ONLY_ACTIVE_ARCH=NO CODE_SIGNING_ALLOWED=NO
      artifact="$mobile/build/ios/Build/Products/$config-iphonesimulator/$name.app"
      ;;
    android)
      export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
      [ -n "${JAVA_HOME:-}" ] || JAVA_HOME=$(/usr/libexec/java_home -v 17 2>/dev/null || true)
      export JAVA_HOME
      pnpm exec expo prebuild --platform android --no-install
      (cd android && ./gradlew ":app:assemble$config")
      artifact="$mobile/android/app/build/outputs/apk/$profile/app-$profile.apk"
      ;;
  esac
  [ -e "$artifact" ] || {
    echo "build finished but $artifact is missing"
    exit 1
  }
  # Date the binary's OTA baseline, as a cache hit does (tools/expo-build-cache, laneOta).
  if [ "$platform" = ios ] && [ "$profile" = release ] && [ -f "$cache_cli" ]; then
    node "$cache_cli" stamp "$artifact" "$mobile" || echo "could not date the binary's OTA baseline"
  fi
  # Fill the cache under the hash the binary embeds (prebuild just wrote it to fingerprint.json).
  if [ -n "$native_fp" ]; then
    embedded=$(node -e 'try { console.log(require(process.argv[1])[process.argv[2]].hash) } catch {}' "$mobile/fingerprint.json" "$platform")
    [ -z "$embedded" ] || [ "$embedded" = "$native_fp" ] || echo "build cache: the binary embeds $embedded, not $native_fp; caching it under $embedded"
    node "$cache_cli" store "$platform" "$profile" "${embedded:-$native_fp}" "$artifact" "$(git rev-parse --short HEAD)" \
      || echo "build cache: could not store the build (the build itself is fine)"
  fi
  echo "$artifact" >"$log.artifact"
  echo "$artifact" >"$state_dir/artifact-$platform"
  echo "built $artifact ($(($(date +%s) - started))s)"
}

cmd_build() {
  platform=${1:-}
  profile=${2:-}
  case $platform in
    ios)
      [ "$(uname -s)" = Darwin ] || unavailable "iOS builds need macOS"
      command -v xcodebuild >/dev/null 2>&1 || unavailable "xcodebuild not found (Xcode)"
      command -v pod >/dev/null 2>&1 || unavailable "CocoaPods (pod) not found"
      ;;
    android)
      [ -d "${ANDROID_HOME:-$HOME/Library/Android/sdk}" ] || unavailable "no Android SDK (ANDROID_HOME)"
      ;;
    *) usage ;;
  esac
  case $profile in release | debug) ;; *) usage ;; esac
  # One build per worktree at a time. A second one would recompute the fingerprint, and loading
  # hot-updater's config restores node_modules files that a running pod install or native step
  # writes (docs/internal/NATIVE-CAPABILITIES.md): it would corrupt the build in flight.
  running=$(cat "$state_dir/build.running" 2>/dev/null || true)
  if [ -n "$running" ] && [ ! -f "$running.exit" ] && alive "$(cat "$running.pid" 2>/dev/null)"; then
    die "a build of this worktree is still running: wait for $running.exit (cat it), then build again"
  fi
  log="$state_dir/logs/build-$platform-$profile-$(date +%Y%m%d-%H%M%S).log"
  mkdir -p "$state_dir"
  echo "$log" >"$state_dir/build.running"
  # The detached build runs from a copy of this script: sh reads a script as it runs, so a
  # checkout or merge that rewrites device-lane.sh mid-build would derail the build.
  cp "$self" "$state_dir/device-lane.build.sh"
  detach "$log" sh "$state_dir/device-lane.build.sh" __build "$platform" "$profile" "$log"
  echo "$log"
}

cmd_install() {
  require_lease
  platform=$(state_get platform)
  path=${1:-$(cat "$state_dir/artifact-$platform" 2>/dev/null || true)}
  [ -n "$path" ] && [ -e "$path" ] || die "nothing to install: run 'device-lane.sh build $platform release' and wait for its .exit"
  renew_if_due
  agent_device install "$app_id" "$path"
  case $path in
    *Debug-iphonesimulator* | *-debug.apk) state_set installed debug ;;
    *) state_set installed release ;;
  esac
}

# ---------------------------------------------------------------------------------------------
# metro

port_free() {
  node -e '
    const s = require("net").createServer().once("error", () => process.exit(1))
      .once("listening", () => s.close(() => process.exit(0))).listen(Number(process.argv[1]), "127.0.0.1");
  ' "$1"
}

cmd_metro() {
  case ${1:-} in
    start)
      require_lease
      pid=$(state_get metroPid)
      if alive "$pid"; then
        echo "metro: already on port $(state_get metroPort) (pid $pid)"
        return 0
      fi
      port=$((8100 + $(printf '%s' "$lane" | cksum | cut -d ' ' -f 1) % 100))
      tries=0
      until port_free "$port"; do
        port=$((port + 1))
        tries=$((tries + 1))
        [ "$tries" -lt 100 ] || die "no free port for Metro from 8100"
      done
      log="$state_dir/logs/metro-$(date +%Y%m%d-%H%M%S).log"
      detach "$log" env WITH_ROZENITE=true APPDUCT_ENABLED=1 \
        pnpm --filter @apex/mobile exec expo start --dev-client --port "$port"
      state_set metroPort "$port" metroPid "$(cat "$log.pid")" metroLog "$log"
      waited=0
      until curl -fs "http://127.0.0.1:$port/status" 2>/dev/null | grep -q running; do
        [ ! -f "$log.exit" ] || die "metro exited: $(tail -n 5 "$log")"
        [ "$waited" -lt 120 ] || die "metro did not answer on port $port within 120s; log $log"
        sleep 2
        waited=$((waited + 2))
      done
      echo "metro: port $port (WITH_ROZENITE=true), log $log"
      ;;
    stop)
      pid=$(state_get metroPid)
      # The runner made Metro a process group leader: stop the whole group.
      if alive "$pid"; then kill -TERM "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true; fi
      [ -f "$state" ] && state_set metroPid "" metroPort "" metroLog "" rozeniteSession "" rozeniteTarget ""
      echo "metro: stopped"
      ;;
    *) usage ;;
  esac
}

# ---------------------------------------------------------------------------------------------
# ad

cmd_ad() {
  [ $# -gt 0 ] || usage
  require_lease
  for a in "$@"; do
    case $a in
      --udid | --udid=* | --serial | --serial=* | --device | --device=* | --session | --session=* | --platform | --platform=* | --ios-simulator-device-set*)
        die "device-lane.sh pins the device and session itself; drop $a" ;;
      --shutdown) die "the leased device stays up; simlock reclaims it on release" ;;
    esac
  done
  case $1 in
    install-from-source | react-devtools | daemon | connect | disconnect | prepare)
      die "agent-device $1 is not part of a lane (it downloads, or changes the host)" ;;
  esac
  renew_if_due
  case $1 in
    replay)
      # replay starts a private daemon by default, and its steps lose the device set
      # (agent-device 0.21.20). Run it in the shared daemon, inside the lane's session, which
      # already carries the set: open the app first, so the session exists.
      agent_device open "$app_id" >/dev/null
      [ "$(state_get platform)" = android ] || {
        AGENT_DEVICE_STATE_DIR=${AGENT_DEVICE_STATE_DIR:-$HOME/.agent-device}
        export AGENT_DEVICE_STATE_DIR
      }
      ;;
    test)
      # `agent-device test` gives each script a session of its own, which loses the device
      # set too; run the scripts one by one with replay instead.
      shift
      [ $# -gt 0 ] || die "usage: device-lane.sh ad test <script.ad|glob>..."
      passed=0
      failed=
      for pattern in "$@"; do
        # shellcheck disable=SC2086
        for f in $pattern; do
          [ -f "$f" ] || die "no such script: $f"
          if "$self" ad replay "$f"; then
            passed=$((passed + 1))
          else
            failed="$failed $f"
          fi
        done
      done
      echo "e2e: $passed passed${failed:+, failed:$failed}"
      [ -z "$failed" ]
      return
      ;;
  esac
  port=$(state_get metroPort)
  if [ "$1" = open ] && [ -n "$port" ]; then
    # A debug build is an Expo dev client: opened bare it shows its launcher. Hand it the
    # lane's Metro through the dev-client link, unless the caller opens a URL of their own.
    if [ "$(state_get installed)" = debug ] && [ "${2:-}" = "$app_id" ] && { [ $# -eq 2 ] || case ${3:-} in -*) true ;; *) false ;; esac; }; then
      host=127.0.0.1
      [ "$(state_get platform)" = android ] && host=10.0.2.2
      # On a fresh device iOS asks "Open in Apex Factory?" and agent-device leaves that
      # prompt up for this link (seen with 0.21.20): accept it, then open as asked, which
      # returns the snapshot. The first load bundles over Metro; wait for text after it.
      agent_device open "$2" "apexfactory://expo-development-client/?url=http%3A%2F%2F$host%3A$port" >/dev/null 2>&1 || true
      agent_device alert accept >/dev/null 2>&1 || true
    fi
    case " $* " in *" --metro-port"*) ;; *) set -- "$@" --metro-host 127.0.0.1 --metro-port "$port" ;; esac
  fi
  ad_with_retry "$@"
}

# Runs an agent-device command once more when it failed in a way that is about the host, not
# the app: CoreSimulator answering late, the XCUITest runner lost or restarted (another lane's
# client timeout can make agent-device recycle runners), the daemon connection dropped. A
# check that fails on the app's state fails the same way twice, so a retry never hides it.
# Exit 76 after the retry: the device side is unhealthy, which is not the app's failure.
ad_with_retry() {
  out="$state_dir/logs/ad-last.out"
  mkdir -p "$state_dir/logs"
  if agent_device "$@" >"$out" 2>&1; then rc=0; else rc=$?; fi
  cat "$out"
  [ "$rc" -ne 0 ] || return 0
  if grep -qiE 'did not answer within|runner (exited|crashed|disconnected|not running|lost)|xctest|ECONNRESET|ECONNREFUSED|socket hang up|daemon (restarted|unavailable)|session .*(closed|not found)|SESSION_NOT_FOUND|DEVICE_NOT_READY' "$out"; then
    echo "device-lane: agent-device $1 hit a device-side failure; retrying once" >&2
    renew_if_due
    if agent_device "$@"; then return 0; fi
    echo "device-lane: agent-device $1 failed twice on the device side (see above); the device or its runner is unhealthy — release, lease again, and retry once; report unavailable if it repeats" >&2
    exit 76
  fi
  exit "$rc"
}

cmd_screenshot() {
  name=${1:?usage: device-lane.sh screenshot <name>}
  case $name in *[!A-Za-z0-9._-]* | .*) die "screenshot name: letters, digits, . _ - only" ;; esac
  require_lease
  shots="$main_root/.worktrees/sim-shots"
  mkdir -p "$shots"
  renew_if_due
  agent_device screenshot "$shots/$name.png"
  echo "screenshot: $shots/$name.png"
}

# ---------------------------------------------------------------------------------------------
# appduct

appduct() { (cd "$mobile" && pnpm exec appduct "$@"); }

appduct_session() {
  sid=$(state_get appductSession)
  [ -n "$sid" ] || die "no appduct session: run 'device-lane.sh appduct link' with the app running"
  echo "$sid"
}

cmd_appduct() {
  sub=${1:-}
  [ $# -gt 0 ] && shift
  case $sub in
    link)
      require_lease
      renew_if_due
      out=$(appduct sessions link --json) || die "appduct sessions link failed: $out"
      url=$(json_field "$out" data.deepLink)
      sid=$(json_field "$out" data.sessionId)
      [ -n "$url" ] && [ -n "$sid" ] || die "appduct answered without a link: $out"
      # agent-device delivers the link inside the leased device set (appduct's own --open
      # only sees the default set). It accepts iOS's "Open in Apex Factory?" prompt only when
      # the app was not already in front; otherwise the prompt stays up, so accept it here.
      agent_device open "$app_id" "$url" >/dev/null
      waited=0
      until appduct tools ls "$sid" --limit 1 >/dev/null 2>&1; do
        [ "$waited" -lt 30 ] || die "the app did not claim the appduct link within 30s (is it running?)"
        if [ $((waited % 6)) -eq 2 ]; then agent_device alert accept >/dev/null 2>&1 || true; fi
        sleep 2
        waited=$((waited + 2))
      done
      state_set appductSession "$sid"
      echo "appduct: session $sid"
      ;;
    ls) appduct tools ls "$(appduct_session)" "$@" ;;
    describe) appduct tools describe "$(appduct_session)" "${1:?usage: appduct describe <tool>}" ;;
    call)
      tool=${1:?usage: device-lane.sh appduct call <tool> [json-input]}
      input=${2:-}
      [ -n "$input" ] || input='{}'
      appduct tools call "$(appduct_session)" "$tool" --input "$input" --json
      ;;
    events)
      case ${1:-} in
        ls | since) ev=$1; shift; appduct events "$ev" "$(appduct_session)" "$@" ;;
        *) die "usage: device-lane.sh appduct events <ls|since> [args] (tail never ends)" ;;
      esac
      ;;
    sessions) appduct sessions ls ;;
    *) usage ;;
  esac
}

# ---------------------------------------------------------------------------------------------
# rozenite

rozenite() {
  port=$(state_get metroPort)
  [ -n "$port" ] || die "no Metro for this lane: build debug, install, 'metro start', then open the app"
  (cd "$mobile" && pnpm exec rozenite agent --port "$port" "$@")
}

rozenite_session() {
  sid=$(state_get rozeniteSession)
  if [ -n "$sid" ]; then
    echo "$sid"
    return 0
  fi
  # The lane's Metro has its own port, so normally only the lane's app is connected to it; a
  # target is named after the device. With more than one, APEX_ROZENITE_TARGET picks by name.
  targets=$(rozenite targets)
  want=${APEX_ROZENITE_TARGET:-}
  target=$(node -e '
    let t; try { t = JSON.parse(process.argv[1]); } catch { process.exit(1); }
    t = Array.isArray(t) ? t : (t.items ?? t.targets ?? t.data ?? []);
    const hits = process.argv[2] ? t.filter((x) => String(x.name ?? "").includes(process.argv[2])) : t;
    if (hits.length !== 1) process.exit(1);
    console.log(hits[0].id ?? hits[0].deviceId);
  ' "$targets" "$want") || die "need exactly one Rozenite target${want:+ named '$want'} (is the debug app open on this lane's Metro? APEX_ROZENITE_TARGET picks one): $targets"
  out=$(rozenite session create --deviceId "$target") || die "rozenite session create failed: $out"
  sid=$(json_field "$out" id)
  [ -n "$sid" ] || sid=$(json_field "$out" sessionId)
  [ -n "$sid" ] || sid=$(json_field "$out" session.id)
  [ -n "$sid" ] || die "rozenite answered without a session id: $out"
  state_set rozeniteSession "$sid" rozeniteTarget "$target"
  echo "$sid"
}

cmd_rozenite() {
  require_lease
  case ${1:-} in
    targets) rozenite targets ;;
    session) rozenite_session ;;
    reset)
      # `session stop` can hang on 2.4.0; a session also ends with Metro or the app.
      state_set rozeniteSession "" rozeniteTarget ""
      echo "rozenite: session forgotten"
      ;;
    "") usage ;;
    *)
      sid=$(rozenite_session)
      rozenite "$@" --session "$sid"
      ;;
  esac
}

# ---------------------------------------------------------------------------------------------
# status, release

cmd_status() {
  echo "lane: $agent_id (agent-device session $session)"
  if [ -n "$(state_get leaseId)" ]; then
    lease_summary
  elif [ -f "$state_dir/lease-request.log.pid" ] && alive "$(cat "$state_dir/lease-request.log.pid")"; then
    echo "lease: queued ($(grep '"stage"' "$state_dir/lease-request.log" 2>/dev/null | tail -n 1))"
  else
    echo "lease: none"
  fi
  [ -n "$(state_get metroPort)" ] && echo "metro: port $(state_get metroPort) pid $(state_get metroPid)"
  [ -n "$(state_get appductSession)" ] && echo "appduct: session $(state_get appductSession)"
  [ -n "$(state_get rozeniteSession)" ] && echo "rozenite: session $(state_get rozeniteSession)"
  for p in ios android; do
    [ -f "$state_dir/artifact-$p" ] && echo "last build ($p): $(cat "$state_dir/artifact-$p")"
  done
  base=${APEX_BUILD_LOCK:-/tmp/apex-build.lock}
  busy=0
  for l in "$base".*; do
    [ -d "$l" ] || continue
    busy=$((busy + 1))
    echo "build slot $(basename "$l"): $(cat "$l/root" 2>/dev/null) log $(cat "$l/log" 2>/dev/null)"
  done
  echo "build slots: $busy of ${APEX_BUILD_SLOTS:-1} busy"
  if ! have_simlock; then
    unavailable "no simlock CLI: add it to the workspace, or set SIMLOCK_BIN"
  fi
  if [ "$(uname -s)" = Darwin ] && ! command -v xcrun >/dev/null 2>&1; then
    unavailable "xcrun not found (Xcode command line tools)"
  fi
  simlock status 2>&1 | grep -E '^(Daemon|Capacity|Queue|RAM)' || echo "simlock: no status (the daemon starts on the first lease)"
}

cmd_release() {
  pid=$(cat "$state_dir/lease-request.log.pid" 2>/dev/null || true)
  if alive "$pid"; then
    # A queued request: stopping the waiting CLI withdraws it.
    kill -TERM "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
    rm -f "$state_dir"/lease-request.*
    echo "withdrew the queued lease request"
  fi
  id=$(state_get leaseId)
  if [ -z "$id" ]; then
    # No lease, but agent-device may still hold this lane's session from a lease that died.
    close_stale_session
    echo "released: no lease held by $agent_id; closed its agent-device session ($session) if any"
    return 0
  fi
  cmd_metro stop >/dev/null
  sid=$(state_get appductSession)
  [ -z "$sid" ] || appduct sessions revoke "$sid" >/dev/null 2>&1 || true
  agent_device close >/dev/null 2>&1 || true
  out=$(simlock release "$id" 2>&1) || case $out in
    *UNKNOWN_LEASE* | *"not found"*) ;;
    *) echo "$out" >&2 ;;
  esac
  rm -f "$state"
  echo "released: $id"
}

# ---------------------------------------------------------------------------------------------

cmd=${1:-}
[ $# -gt 0 ] && shift
case $cmd in
  lease) cmd_lease "$@" ;;
  build) cmd_build "$@" ;;
  __build) build_job "$@" ;;
  install) cmd_install "$@" ;;
  metro) cmd_metro "$@" ;;
  ad) cmd_ad "$@" ;;
  appduct) cmd_appduct "$@" ;;
  rozenite) cmd_rozenite "$@" ;;
  screenshot) cmd_screenshot "$@" ;;
  renew) require_lease && renew_lease ;;
  status) cmd_status ;;
  release) cmd_release ;;
  *) usage ;;
esac
