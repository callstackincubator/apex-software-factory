#!/usr/bin/env bash
# Puts Node, the pinned pnpm and gh on PATH for the self-hosted booth runner.
#
#   scripts/ci/runner-env.sh          from the repo root, in a GitHub Actions step
#
# The runner runs as a launchd service whose PATH is the snapshot in
# ~/actions-runner/.path, taken from whatever shell installed it. That snapshot
# can name directories that no longer exist (an fnm "multishell" directory dies
# with its shell), so this script does not trust it: it probes the usual install
# locations, picks the first Node that satisfies package.json's engines, makes
# sure the pinned pnpm is there (.agents/scripts/ensure-pnpm.sh), and appends
# the chosen directories to $GITHUB_PATH so every later step sees them.
#
# Override with APEX_NODE_BIN=<dir containing node> in ~/actions-runner/.env.
set -euo pipefail

root=$(pwd)
min_major=22
min_minor=18

ok_node() {
  local v
  [ -x "$1/node" ] || return 1
  v=$("$1/node" -p 'process.versions.node' 2>/dev/null) || return 1
  local major=${v%%.*} rest=${v#*.}
  local minor=${rest%%.*}
  [ "$major" -gt "$min_major" ] || { [ "$major" -eq "$min_major" ] && [ "$minor" -ge "$min_minor" ]; }
}

candidates=(
  "${APEX_NODE_BIN:-}"
  "$(dirname "$(command -v node 2>/dev/null || echo /nonexistent/node)")"
  "${FNM_DIR:-$HOME/.local/share/fnm}/aliases/default/bin"
  "$HOME/Library/Application Support/fnm/aliases/default/bin"
  "$HOME/.volta/bin"
  /opt/homebrew/opt/node@22/bin
  /opt/homebrew/bin
  /usr/local/opt/node@22/bin
  /usr/local/bin
)
node_bin=
for dir in "${candidates[@]}"; do
  [ -n "$dir" ] || continue
  if ok_node "$dir"; then
    node_bin=$dir
    break
  fi
done
if [ -z "$node_bin" ]; then
  echo "::error title=Node not found::No Node >= $min_major.$min_minor in: ${candidates[*]}. Install Node $(cat "$root/.nvmrc") (fnm, Homebrew node@22) or set APEX_NODE_BIN in ~/actions-runner/.env. See docs/internal/DELIVERY.md, CI and OTA publishing."
  exit 1
fi
export PATH="$node_bin:$PATH"

# gh (waiting for CI, commenting on the merged PR) and a standalone pnpm shim.
extra=()
for dir in "${PNPM_HOME:-$HOME/Library/pnpm}/bin" "${PNPM_HOME:-$HOME/Library/pnpm}" /opt/homebrew/bin /usr/local/bin; do
  [ -d "$dir" ] && extra+=("$dir")
done
for dir in ${extra[@]+"${extra[@]}"}; do
  case ":$PATH:" in *":$dir:"*) ;; *) PATH="$PATH:$dir" ;; esac
done
export PATH

# Prints nothing when the pinned pnpm is already on PATH, else a cache bin dir.
pnpm_bin=$(.agents/scripts/ensure-pnpm.sh)
[ -n "$pnpm_bin" ] && PATH="$pnpm_bin:$PATH"

command -v gh >/dev/null || {
  echo "::error title=gh not found::GitHub CLI missing on the runner (brew install gh). See docs/internal/DELIVERY.md, CI and OTA publishing."
  exit 1
}

# $GITHUB_PATH entries are prepended in order, so the last line wins: add the
# fallbacks first, then pnpm, then node.
if [ -n "${GITHUB_PATH:-}" ]; then
  for ((i = ${#extra[@]} - 1; i >= 0; i--)); do echo "${extra[i]}" >>"$GITHUB_PATH"; done
  [ -n "$pnpm_bin" ] && echo "$pnpm_bin" >>"$GITHUB_PATH"
  echo "$node_bin" >>"$GITHUB_PATH"
fi

echo "node $(node --version) from $node_bin"
echo "pnpm $(pnpm --version) from $(dirname "$(command -v pnpm)")"
echo "gh   $(gh --version | head -1 | awk '{print $3}') from $(dirname "$(command -v gh)")"
