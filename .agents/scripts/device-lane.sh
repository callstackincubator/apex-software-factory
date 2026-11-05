#!/usr/bin/env sh
# One device lane per worktree: an Expo Simulators session (EAS) running a lane binary, driven
# with agent-device, shortcut with appduct. Skills call only this script; it calls only
# `npx eas-cli@27.4.1 {simulator:*, build:list, fingerprint:generate}`, lane-binary.sh and
# `pnpm exec {agent-device,appduct}` (ADR 0028, delivery rule 16).
#
#   device-lane.sh build <ios|android> [release]
#                                               detached lane-binary.sh run (the production build
#                                               repacked on EAS, ADR 0027), prints the log path;
#                                               <log>.exit and <log>.artifact (the build id)
#                                               appear when it ends. Needs no session.
#   device-lane.sh lease <ios|android> [--production | --build-id <id>]
#                                               start an Expo Simulators session with the app
#                                               installed. By default the lane binary of this
#                                               checkout, built first if no `build` is done or
#                                               running for HEAD; --production takes the finished
#                                               production build with this checkout's native
#                                               fingerprint (the OTA check); --build-id takes any
#                                               build. Waits up to APEX_LEASE_WAIT seconds per
#                                               call (540), then exits 2.
#   device-lane.sh install                      nothing to do: lease installed the build; prints it
#   device-lane.sh ad <agent-device args...>    agent-device on the session (name apex-<branch>)
#   device-lane.sh appduct link | ls [args] | describe <tool> | call <tool> [json]
#                         | events <ls|since> [args] | sessions
#                                               appduct: link pairs the running app through
#                                               agent-device; the rest use the lane's session id
#   device-lane.sh screenshot <name>            <main checkout>/.worktrees/sim-shots/<name>.png
#   device-lane.sh record start <name> | stop   a video of the app, to
#                                               <main checkout>/.worktrees/sim-shots/<name>.mp4;
#                                               release stops one still running
#   device-lane.sh renew                        prints when the session ends (it cannot be extended)
#   device-lane.sh status                       this lane's session, egress tunnel and builds
#   device-lane.sh release                      stop the session and its egress tunnel, delete
#                                               .env.eas-simulator; safe to repeat, and after a
#                                               lease that failed halfway
#
# Exit codes: 0 done; 1 failed; 2 still building the binary (run `lease` again to keep
# waiting); 64 usage; 69 unavailable (this machine cannot do it: no npx, not signed in to EAS);
# 75 busy (EAS refused the session for capacity or a concurrency limit); 76 an `ad` command
# failed twice on the device side (the remote runner, not the app: retried once already).
#
# Lane identity: the worktree's branch. EAS session name and agent-device session `apex-<branch>`,
# tag `apex`. State lives in <worktree>/.apex/ (gitignored): device.json (the session, egress
# tunnel, appduct session), logs/, build-<platform> (last binary: build id and commit).
#
# `eas simulator:start` writes apps/mobile/.env.eas-simulator (the daemon URL and token): a
# secret. It is read only to run agent-device and the egress client, never printed, and deleted
# by release. Sessions end by themselves after APEX_SESSION_MAX_MINUTES (default 40, the account maximum) or
# APEX_SESSION_IDLE_MINUTES (default 15) without a command.
#
# Egress: the simulator reaches only the host:port entries it was started with, through a tunnel
# to this machine (`eas simulator:egress`, started by lease, killed by release). They are the
# appduct daemon's advertised address and wss port (APEX_APPDUCT_ENDPOINT=host:port overrides
# the probe) plus APEX_EGRESS_ALLOW, a space-separated list of more host:port entries.
#
# Known gap it works around: iOS's "Open in Apex Factory?" prompt for a deep link into a
# running app is accepted here.
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
session="apex-$lane"
app_id=${APEX_APP_ID:-com.callstack.apexfactory}
state_dir="$root/.apex"
state="$state_dir/device.json"
mobile="$root/apps/mobile"
eas_env="$mobile/.env.eas-simulator"
tab=$(printf '\t')

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

fmt_time() {
  date -r "$1" +%H:%M:%S 2>/dev/null || date -d "@$1" +%H:%M:%S
}

# ---------------------------------------------------------------------------------------------
# Tools.

eas() { (cd "$mobile" && exec npx -y eas-cli@27.4.1 "$@"); }

require_tools() {
  command -v npx >/dev/null 2>&1 || unavailable "npx not found (Node)"
}

require_lease() {
  [ -f "$state" ] && [ -n "$(state_get sessionId)" ] && [ -f "$eas_env" ] \
    || die "no session for lane $session: run .agents/scripts/device-lane.sh lease ios first"
}

# Exports the daemon variables from .env.eas-simulator. It reads three names and nothing else,
# so the file is never evaluated; call it in a subshell.
load_eas_env() {
  while IFS= read -r line; do
    case $line in
      AGENT_DEVICE_DAEMON_BASE_URL=* | AGENT_DEVICE_DAEMON_AUTH_TOKEN=* | EAS_SIMULATOR_SESSION_ID=*)
        key=${line%%=*}
        val=${line#*=}
        case $val in
          \'*\' | \"*\") val=${val#?} val=${val%?} ;;
        esac
        export "$key=$val"
        ;;
    esac
  done <"$eas_env"
}

# Runs agent-device on the session. Callers pass the command and its arguments.
agent_device() {
  (
    load_eas_env
    export AGENT_DEVICE_SESSION="$session"
    exec pnpm exec agent-device "$@" --platform "$(state_get platform)"
  )
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
# EAS sessions

# One line per session: id, name, status.
list_sessions() {
  out=$(eas simulator:list --json --non-interactive 2>/dev/null) || return 1
  node -e '
    let v; try { v = JSON.parse(process.argv[1]); } catch { process.exit(1); }
    if (!Array.isArray(v)) v = v.sessions ?? v.items ?? v.data ?? [];
    for (const s of v) console.log([s.id, s.name ?? "", s.status ?? s.state ?? ""].join("\t"));
  ' "$out"
}

is_live() {
  case $(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]') in
    *stop* | *expire* | *terminat* | *ended* | *fail* | *error* | *cancel*) return 1 ;;
  esac
}

# Stops every live session named like this lane's: what a lease that died after `start` leaves.
sweep_orphans() {
  list_sessions | while IFS="$tab" read -r sid name st; do
    if [ "$name" = "$session" ] && is_live "$st"; then
      eas simulator:stop --id "$sid" --non-interactive >/dev/null 2>&1 || true
    fi
  done
}

session_live() {
  st=$(list_sessions | awk -F"$tab" -v id="$1" '$1 == id { print $3 }') || return 1
  [ -n "$st" ] || return 1
  is_live "$st"
}

# ---------------------------------------------------------------------------------------------
# egress

start_egress() {
  log="$state_dir/logs/egress-$(date +%Y%m%d-%H%M%S).log"
  # shellcheck disable=SC2016
  detach "$log" sh -c 'cd "$1" && exec npx -y eas-cli@27.4.1 simulator:egress' _ "$mobile"
  state_set egressPid "$(cat "$log.pid")" egressLog "$log"
  sleep 3
  alive "$(state_get egressPid)" || die "the egress tunnel exited: $(tail -n 3 "$log")"
}

stop_egress() {
  pid=$(state_get egressPid)
  # The runner made the client a process group leader: stop the whole group.
  if alive "$pid"; then kill -TERM "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true; fi
  [ ! -f "$state" ] || state_set egressPid "" egressLog ""
}

# ---------------------------------------------------------------------------------------------
# appduct

appduct() { (cd "$mobile" && pnpm exec appduct "$@"); }

# The address and port the app will be told to reach the appduct daemon on: they must be in the
# session's egress allow-list before it starts. A link is minted to read them, then revoked.
appduct_endpoint() {
  if [ -n "${APEX_APPDUCT_ENDPOINT:-}" ]; then
    echo "$APEX_APPDUCT_ENDPOINT"
    return 0
  fi
  out=$(appduct sessions link --json) || die "appduct sessions link failed (the endpoint is needed for egress): $out"
  addr=$(json_field "$out" data.endpoint.address)
  port=$(json_field "$out" data.endpoint.port)
  [ -n "$addr" ] && [ -n "$port" ] || die "appduct answered without an endpoint: set APEX_APPDUCT_ENDPOINT=host:port"
  probe=$(json_field "$out" data.sessionId)
  [ -z "$probe" ] || appduct sessions revoke "$probe" >/dev/null 2>&1 || true
  echo "$addr:$port"
}

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
      alive "$(state_get egressPid)" || {
        echo "the egress tunnel was down; starting it again" >&2
        start_egress
      }
      out=$(appduct sessions link --json) || die "appduct sessions link failed: $out"
      url=$(json_field "$out" data.deepLink)
      sid=$(json_field "$out" data.sessionId)
      [ -n "$url" ] && [ -n "$sid" ] || die "appduct answered without a link: $out"
      advertised="$(json_field "$out" data.endpoint.address):$(json_field "$out" data.endpoint.port)"
      [ "$advertised" = "$(state_get appductEndpoint)" ] \
        || die "the link advertises $advertised but the session only reaches $(state_get appductEndpoint): release and lease again"
      # The XCUITest prompt "Open in Apex Factory?" stays up for a link into a running app: accept it.
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
# build

# Runs detached, output in the log (see cmd_build).
build_job() {
  platform=$1
  log=$2
  started=$(date +%s)
  echo "lane binary ($platform) of $root at $(git rev-parse --short HEAD)"
  id=$("$root/.agents/scripts/lane-binary.sh" "$platform") || exit 1
  echo "$id" >"$log.artifact"
  echo "$id $(git rev-parse HEAD)" >"$state_dir/build-$platform"
  echo "built $id ($(($(date +%s) - started))s)"
}

# A build of this platform running now, if any: its log.
build_in_flight() {
  running=$(cat "$state_dir/build.running" 2>/dev/null || true)
  [ -n "$running" ] && [ ! -f "$running.exit" ] && alive "$(cat "$running.pid" 2>/dev/null)" || return 1
  case $running in *"/build-$1-"*) echo "$running" ;; *) return 1 ;; esac
}

cmd_build() {
  platform=${1:-}
  profile=${2:-release}
  case $platform in ios | android) ;; *) usage ;; esac
  case $profile in
    release) ;;
    debug) die "there are no debug builds: a lane binary is a release build (ADR 0028)" ;;
    *) usage ;;
  esac
  require_tools
  # One build per worktree at a time.
  running=$(cat "$state_dir/build.running" 2>/dev/null || true)
  if [ -n "$running" ] && [ ! -f "$running.exit" ] && alive "$(cat "$running.pid" 2>/dev/null)"; then
    die "a build of this worktree is still running: wait for $running.exit (cat it), then build again"
  fi
  log="$state_dir/logs/build-$platform-$(date +%Y%m%d-%H%M%S).log"
  mkdir -p "$state_dir"
  echo "$log" >"$state_dir/build.running"
  # The detached build runs from a copy of this script: sh reads a script as it runs, so a
  # checkout or merge that rewrites device-lane.sh mid-build would derail the build.
  cp "$self" "$state_dir/device-lane.build.sh"
  detach "$log" sh "$state_dir/device-lane.build.sh" __build "$platform" "$log"
  echo "$log"
}

# ---------------------------------------------------------------------------------------------
# lease

# The build id of the lane binary for HEAD, building it first when needed; exits 2 while it runs.
lane_build_id() {
  rec=$(cat "$state_dir/build-$platform" 2>/dev/null || true)
  if [ -n "$rec" ] && [ "${rec#* }" = "$(git rev-parse HEAD)" ]; then
    echo "${rec%% *}"
    return 0
  fi
  if ! log=$(build_in_flight "$platform"); then
    log=$(cmd_build "$platform")
    echo "building the lane binary for $platform (log $log)" >&2
  fi
  waited=0
  limit=${APEX_LEASE_WAIT:-540}
  while [ ! -f "$log.exit" ]; do
    if [ "$waited" -ge "$limit" ]; then
      echo "still building the lane binary; run 'device-lane.sh lease $platform' again to keep waiting" >&2
      exit 2
    fi
    sleep 3
    waited=$((waited + 3))
  done
  [ "$(cat "$log.exit")" = 0 ] || die "the lane binary build failed: $(tail -n 5 "$log")"
  cat "$log.artifact"
}

# The finished production build with this checkout's native fingerprint.
production_build_id() {
  out=$(export APPDUCT_ENABLED=1 WITH_ROZENITE=; eas fingerprint:generate --platform "$platform" \
    --build-profile production --json --non-interactive) || die "eas fingerprint:generate failed"
  hash=$(json_field "$out" hash)
  case $hash in
    *[!0-9a-f]* | "") die "eas fingerprint:generate returned no hash" ;;
  esac
  found=$(eas build:list --platform "$platform" --build-profile production --status finished \
    --fingerprint-hash "$hash" --limit 1 --json --non-interactive) || die "eas build:list failed"
  id=$(json_field "$found" 0.id)
  [ -n "$id" ] || die "no finished production build has fingerprint $hash (a native change?)"
  echo "$id"
}

lease_summary() {
  echo "leased: $(state_get sessionId) $(state_get platform) build $(state_get buildId) ($(state_get buildKind)) for $session until $(fmt_time "$(state_get expiresAt)")"
}

cmd_lease() {
  platform=${1:-}
  case $platform in ios | android) shift ;; *) usage ;; esac
  kind=lane
  given=
  while [ $# -gt 0 ]; do
    case $1 in
      --production) kind=production ;;
      --build-id)
        kind=given
        given=${2:?usage: device-lane.sh lease <ios|android> [--production | --build-id <id>]}
        shift
        ;;
      -*) usage ;;
      *) echo "ignoring '$1': Expo Simulators pick the device model" >&2 ;;
    esac
    shift
  done
  require_tools

  # Already leased: keep it while EAS still has it.
  if [ -n "$(state_get sessionId)" ]; then
    if [ -f "$eas_env" ] && session_live "$(state_get sessionId)"; then
      [ "$(state_get platform)" = "$platform" ] || die "this lane already holds a $(state_get platform) session; release it first"
      lease_summary
      return 0
    fi
    echo "the lane's session $(state_get sessionId) is gone; leasing again" >&2
    cmd_release >/dev/null
  fi

  case $kind in
    lane) build_id=$(lane_build_id) ;;
    production) build_id=$(production_build_id) ;;
    given) build_id=$given ;;
  esac
  [ -n "$build_id" ] || die "no build to install"

  endpoint=$(appduct_endpoint)

  # Until the state names the session, a failure must not strand it.
  trap 'cmd_release >/dev/null 2>&1 || true' EXIT
  sweep_orphans
  max=${APEX_SESSION_MAX_MINUTES:-40}
  idle=${APEX_SESSION_IDLE_MINUTES:-15}
  set -- simulator:start -p "$platform" --type agent-device --build-id "$build_id" \
    --max-duration-minutes "$max" --max-idle-time-minutes "$idle" --name "$session" --tag apex \
    --json --non-interactive --egress local --egress-allow "$endpoint"
  for extra in ${APEX_EGRESS_ALLOW:-}; do set -- "$@" --egress-allow "$extra"; done
  mkdir -p "$state_dir/logs"
  echo "starting a $platform simulator with build $build_id (about a minute)" >&2
  if ! out=$(eas "$@" 2>"$state_dir/logs/start.err"); then
    err=$(tail -n 5 "$state_dir/logs/start.err")
    trap - EXIT
    cmd_release >/dev/null 2>&1 || true
    case $err in
      *[Nn]ot\ logged\ in* | *EXPO_TOKEN* | *uthenticat*) unavailable "not signed in to EAS: $err" ;;
      *oncurren* | *apacity* | *[Ll]imit*) echo "busy: EAS refused the session: $err" >&2; exit 75 ;;
    esac
    die "eas simulator:start failed: $err"
  fi
  sid=$(json_field "$out" id)
  [ -n "$sid" ] || die "eas simulator:start answered without a session id"
  now=$(date +%s)
  state_set \
    platform "$platform" \
    sessionId "$sid" \
    session "$session" \
    buildId "$build_id" \
    buildKind "$kind" \
    appductEndpoint "$endpoint" \
    startedAt "$now" \
    expiresAt "$((now + max * 60))"
  [ -f "$eas_env" ] || die "eas simulator:start wrote no .env.eas-simulator"
  start_egress
  trap - EXIT
  lease_summary
}

cmd_install() {
  require_lease
  echo "installed by lease: build $(state_get buildId) ($(state_get buildKind))"
}

# ---------------------------------------------------------------------------------------------
# ad

cmd_ad() {
  [ $# -gt 0 ] || usage
  require_lease
  for a in "$@"; do
    case $a in
      --udid | --udid=* | --serial | --serial=* | --device | --device=* | --session | --session=* | --platform | --platform=* | --ios-simulator-device-set*)
        die "device-lane.sh pins the platform and session itself; drop $a" ;;
      --shutdown) die "the session stays up; release stops it" ;;
    esac
  done
  case $1 in
    install-from-source | react-devtools | daemon | connect | disconnect | prepare)
      die "agent-device $1 is not part of a lane (it downloads, or changes the host)" ;;
  esac
  case $1 in
    replay)
      # Run inside the lane's session, which must exist: open the app first.
      agent_device open "$app_id" >/dev/null
      ;;
    test)
      # Run the scripts one by one with replay, each in the lane's session.
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
  ad_with_retry "$@"
}

# Runs an agent-device command once more when it failed in a way that is about the device side,
# not the app: the remote runner lost or restarted, the daemon connection dropped. A check that
# fails on the app's state fails the same way twice, so a retry never hides it. A command run
# before `open` fails with SESSION_NOT_FOUND, which is not retried: open the app first.
# Exit 76 after the retry: the device side is unhealthy, which is not the app's failure.
ad_with_retry() {
  out="$state_dir/logs/ad-last.out"
  mkdir -p "$state_dir/logs"
  if agent_device "$@" >"$out" 2>&1; then rc=0; else rc=$?; fi
  cat "$out"
  [ "$rc" -ne 0 ] || return 0
  if grep -qiE 'did not answer within|runner (exited|crashed|disconnected|not running|lost)|xctest|ECONNRESET|ECONNREFUSED|socket hang up|daemon (restarted|unavailable)|DEVICE_NOT_READY' "$out"; then
    echo "device-lane: agent-device $1 hit a device-side failure; retrying once" >&2
    if agent_device "$@"; then return 0; fi
    echo "device-lane: agent-device $1 failed twice on the device side (see above); the session or its runner is unhealthy — release, lease again, and retry once; report unavailable if it repeats" >&2
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
  agent_device screenshot "$shots/$name.png"
  echo "screenshot: $shots/$name.png"
}

cmd_record() {
  case ${1:-} in
    start)
      name=${2:?usage: device-lane.sh record start <name> | record stop}
      case $name in *[!A-Za-z0-9._-]* | .*) die "recording name: letters, digits, . _ - only" ;; esac
      require_lease
      shots="$main_root/.worktrees/sim-shots"
      mkdir -p "$shots"
      agent_device record start "$shots/$name.mp4" --quality medium >/dev/null
      state_set recording "$shots/$name.mp4"
      echo "recording: $shots/$name.mp4"
      ;;
    stop)
      require_lease
      file=$(state_get recording)
      [ -n "$file" ] || die "no recording running in this lane"
      agent_device record stop >/dev/null
      state_set recording ""
      echo "recorded: $file"
      ;;
    *) die "usage: device-lane.sh record start <name> | record stop" ;;
  esac
}

# ---------------------------------------------------------------------------------------------
# renew, status, release

cmd_renew() {
  require_lease
  echo "no renewal on Expo Simulators: session $(state_get sessionId) ends at $(fmt_time "$(state_get expiresAt)"), or after ${APEX_SESSION_IDLE_MINUTES:-15} idle minutes"
}

cmd_status() {
  require_tools
  echo "lane: $session"
  if [ -n "$(state_get sessionId)" ]; then
    lease_summary
    st=$(list_sessions 2>/dev/null | awk -F"$tab" -v id="$(state_get sessionId)" '$1 == id { print $3 }' || true)
    echo "eas: session $(state_get sessionId) ${st:-not listed}"
    if alive "$(state_get egressPid)"; then
      echo "egress: pid $(state_get egressPid) allows $(state_get appductEndpoint)${APEX_EGRESS_ALLOW:+ $APEX_EGRESS_ALLOW}"
    else
      echo "egress: not running"
    fi
  else
    echo "lease: none"
  fi
  [ -n "$(state_get appductSession)" ] && echo "appduct: session $(state_get appductSession)"
  for p in ios android; do
    [ -f "$state_dir/build-$p" ] && echo "last binary ($p): $(cat "$state_dir/build-$p")"
    if log=$(build_in_flight "$p"); then echo "building ($p): $log"; fi
  done
}

cmd_release() {
  require_tools
  id=$(state_get sessionId)
  if [ -n "$id" ] && [ -f "$eas_env" ]; then
    # A recorder left running holds the session's recording; the agent-device session closes with it.
    [ -z "$(state_get recording)" ] || agent_device record stop >/dev/null 2>&1 || true
    sid=$(state_get appductSession)
    [ -z "$sid" ] || appduct sessions revoke "$sid" >/dev/null 2>&1 || true
    agent_device close >/dev/null 2>&1 || true
  fi
  stop_egress
  failed=
  if [ -n "$id" ]; then
    out=$(eas simulator:stop --id "$id" --non-interactive 2>&1) || case $out in
      *"not found"* | *"already"* | *stopped* | *ended* | *expired*) ;;
      *) echo "$out" >&2; failed=1 ;;
    esac
  fi
  rm -f "$eas_env"
  sweep_orphans
  if [ -n "$failed" ]; then
    echo "could not stop session $id: run release again (it ends by itself within ${APEX_SESSION_IDLE_MINUTES:-15} idle minutes)" >&2
    return 1
  fi
  rm -f "$state"
  if [ -n "$id" ]; then echo "released: $id"; else echo "released: no session held by $session; stopped any leftover named like it"; fi
}

# ---------------------------------------------------------------------------------------------

cmd=${1:-}
[ $# -gt 0 ] && shift
case $cmd in
  lease) cmd_lease "$@" ;;
  build) cmd_build "$@" ;;
  __build) build_job "$@" ;;
  install) cmd_install ;;
  ad) cmd_ad "$@" ;;
  appduct) cmd_appduct "$@" ;;
  screenshot) cmd_screenshot "$@" ;;
  record) cmd_record "$@" ;;
  renew) cmd_renew ;;
  status) cmd_status ;;
  release) cmd_release ;;
  *) usage ;;
esac
