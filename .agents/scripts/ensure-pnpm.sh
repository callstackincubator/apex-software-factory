#!/usr/bin/env sh
# Makes sure the pnpm version package.json pins (packageManager) is the one on PATH.
#
#   .agents/scripts/ensure-pnpm.sh     prints the bin directory to put first on PATH, or nothing
#
#   bin=$(.agents/scripts/ensure-pnpm.sh); [ -n "$bin" ] && PATH="$bin:$PATH"
#
# The pnpm on PATH is used when it is the pinned version. Otherwise, missing or wrong, the
# pinned version is installed once into ~/.cache/apex-software-factory/pnpm-<version> with npm
# and used from there; the global pnpm and node are never touched. This is the one download
# this script may make, and it is the same package `pnpm install` would need anyway.
#
# Prints nothing and changes nothing when the right pnpm is already on PATH. Messages go to
# stderr, so stdout carries only the bin directory.
set -eu

root=$(git rev-parse --show-toplevel)
want=$(node -p 'String(require(process.argv[1]).packageManager || "").replace(/^pnpm@/, "").split("+")[0]' "$root/package.json")

if [ -z "$want" ]; then
  echo "package.json has no packageManager pin" >&2
  exit 1
fi

if [ "$(pnpm --version 2>/dev/null || true)" = "$want" ]; then
  exit 0
fi

dir="${XDG_CACHE_HOME:-$HOME/.cache}/apex-software-factory/pnpm-$want"
bin="$dir/node_modules/.bin"
if [ "$("$bin/pnpm" --version 2>/dev/null || true)" != "$want" ]; then
  echo "pnpm $want not on PATH; installing it into $dir" >&2
  mkdir -p "$dir"
  # npm runs outside the repo so the workspace's packageManager pin does not apply to it.
  (cd "$dir" && npm install --prefix "$dir" --no-save --no-audit --no-fund --loglevel=error "pnpm@$want" >&2)
fi

echo "$bin"
