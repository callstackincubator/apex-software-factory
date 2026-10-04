#!/usr/bin/env sh
# Runs one step of the iOS simulator lane for the current worktree, detached, one step per
# machine at a time.
#
#   .agents/scripts/sim-lane.sh build                 Release build of apps/mobile, installed
#                                                     and launched on the simulator
#   .agents/scripts/sim-lane.sh flow <flow.yaml>...   Maestro flows against the installed build
#   .agents/scripts/sim-lane.sh screenshot <name>     screenshot of the booted simulator, saved as
#                                                     <main checkout>/.worktrees/sim-shots/<name>.png
#   .agents/scripts/sim-lane.sh status                who holds the lane, if anyone
#
# Prints the log path and exits at once. The step writes its exit code to <log>.exit when it
# ends. Exits 75 without starting when another worktree holds the lane: one simulator and one
# Xcode build at a time, or timeouts look like bugs. Exits 69 when this machine cannot run the
# step (not macOS, no Xcode, no Maestro); nothing is ever installed to make it possible.
#
# The lock is a directory holding the runner's pid; a lock whose pid is gone is stale and is
# taken over. The step is detached from the calling shell, so no tool time limit kills a build
# halfway. Set APEX_SIM_DEVICE to a simulator name to target it; otherwise the booted one (or
# Expo's default) is used. The only other simulator state this touches is the app it installs.
set -eu

root=$(git rev-parse --show-toplevel)
lock=/tmp/apex-sim-lane.lock
step=${1:?usage: sim-lane.sh build | flow <flow.yaml>... | screenshot <name> | status}
shift

holder() {
  echo "pid $(cat "$lock/pid" 2>/dev/null || echo '?') from $(cat "$lock/root" 2>/dev/null || echo '?'), step $(cat "$lock/step" 2>/dev/null || echo '?'), log $(cat "$lock/log" 2>/dev/null || echo '?')"
}

unavailable() {
  echo "unavailable: $*" >&2
  exit 69
}

[ "$(uname -s)" = Darwin ] || unavailable "the iOS simulator needs macOS"
command -v xcrun >/dev/null 2>&1 || unavailable "xcrun not found (Xcode command line tools)"

case $step in
  status)
    if [ -d "$lock" ]; then echo "busy: $(holder)"; else echo "free"; fi
    exit 0
    ;;
  build)
    set -- pnpm --filter ./apps/mobile exec expo run:ios --configuration Release --no-bundler
    if [ -n "${APEX_SIM_DEVICE:-}" ]; then set -- "$@" --device "$APEX_SIM_DEVICE"; fi
    ;;
  flow)
    [ $# -gt 0 ] || { echo "usage: sim-lane.sh flow <flow.yaml>..." >&2; exit 1; }
    command -v maestro >/dev/null 2>&1 || unavailable "maestro not on PATH"
    for f in "$@"; do
      case $f in
        *.yaml | *.yml) [ -f "$f" ] || { echo "no such flow: $f" >&2; exit 1; } ;;
        *) echo "a flow is a .yaml file: $f" >&2; exit 1 ;;
      esac
    done
    set -- maestro test "$@"
    ;;
  screenshot)
    name=${1:?usage: sim-lane.sh screenshot <name>}
    case $name in *[!A-Za-z0-9._-]* | .*) echo "screenshot name: letters, digits, . _ - only" >&2; exit 1 ;; esac
    shots="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")/.worktrees/sim-shots"
    mkdir -p "$shots"
    echo "screenshot: $shots/$name.png" >&2
    set -- xcrun simctl io booted screenshot "$shots/$name.png"
    ;;
  *)
    echo "unknown step: $step (build, flow, screenshot, status)" >&2
    exit 1
    ;;
esac

log="${TMPDIR:-/tmp}/apex-sim-lane-$step-$(date +%Y%m%d-%H%M%S).log"

if ! mkdir "$lock" 2>/dev/null; then
  pid=$(cat "$lock/pid" 2>/dev/null || echo "")
  # No pid yet means another caller is still starting its runner, unless that was long ago.
  if { [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; } \
    || { [ -z "$pid" ] && [ -n "$(find "$lock" -maxdepth 0 -mmin -1)" ]; }; then
    echo "busy: $(holder)" >&2
    exit 75
  fi
  rm -rf "$lock"
  mkdir "$lock"
fi
echo "$root" >"$lock/root"
echo "$log" >"$lock/log"
echo "$step" >"$lock/step"

# The runner owns the lock from here: it records its pid, runs the step, writes the exit code,
# and removes the lock however the step ends.
python3 - "$lock" "$log" "$root" "$@" <<'EOF'
import os, subprocess, sys
lock, log, root, argv = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4:]
child = os.fork()
if child != 0:
    # Written before this returns, so a second caller never sees a lock without a live pid.
    with open(os.path.join(lock, "pid"), "w") as f:
        f.write(str(child))
    sys.exit(0)
os.setsid()
# Let go of the caller's stdout and stderr, or `$(sim-lane.sh ...)` waits for the whole step.
null = os.open(os.devnull, os.O_RDWR)
for fd in (0, 1, 2):
    os.dup2(null, fd)
with open(log, "w") as out:
    try:
        code = subprocess.call(argv, cwd=root, stdout=out, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL)
    except OSError as e:
        out.write(f"could not start {argv[0]}: {e}\n")
        code = 127
with open(log + ".exit", "w") as f:
    f.write(f"{code}\n")
subprocess.call(["rm", "-rf", lock])
EOF

echo "$log"
