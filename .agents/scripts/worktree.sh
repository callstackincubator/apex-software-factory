#!/usr/bin/env sh
# Creates a git worktree under <main checkout>/.worktrees/ and installs its dependencies.
#
#   .agents/scripts/worktree.sh <branch> [base]     base defaults to origin/main
#   .agents/scripts/worktree.sh --prepare <dir>     install into an existing worktree
#
# Prints the worktree path as the last stdout line; every other message goes to stderr, so
#   dir=$(.agents/scripts/worktree.sh task/12)
# works. <branch> is a delivery branch (task/12, bug/7, feature/3, bug/7-repro): its directory
# is the branch with "/" replaced by "-". An existing local branch is checked out; otherwise an
# existing origin/<branch> is tracked, so delivery resumes where it stopped; otherwise the
# branch is created from base.
#
# On macOS the main checkout's node_modules is cloned with APFS clonefile(2) first (no data is
# copied), so `pnpm install --offline` only relinks. Without it pnpm links from its store, and
# goes online once only when the store lacks a package the branch's lockfile needs.
#
# This replaces the editor hook a worktree would otherwise get: skills call it explicitly.
set -eu

main_root=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")

use_pinned_pnpm() {
  bin=$("$(dirname "$0")/ensure-pnpm.sh")
  if [ -n "$bin" ]; then
    PATH="$bin:$PATH"
    export PATH
  fi
}

prepare() {
  dir=$1
  use_pinned_pnpm
  if [ "$(uname)" = Darwin ] && [ -d "$main_root/node_modules" ] && [ ! -e "$dir/node_modules" ]; then
    python3 - "$main_root/node_modules" "$dir/node_modules" <<'EOF' >&2 || true
import ctypes, os, sys
src, dst = sys.argv[1], sys.argv[2]
libc = ctypes.CDLL("libSystem.dylib", use_errno=True)
if libc.clonefile(src.encode(), dst.encode(), 0) != 0:
    print(f"clonefile {src}: {os.strerror(ctypes.get_errno())}; installing without it")
EOF
  fi
  (
    cd "$dir"
    pnpm install --frozen-lockfile --offline >/dev/null 2>&1 \
      || pnpm install --frozen-lockfile >&2
  )
}

if [ "${1:-}" = "--prepare" ]; then
  prepare "${2:?usage: worktree.sh --prepare <dir>}"
  exit 0
fi

branch=${1:?usage: worktree.sh <branch> [base] | --prepare <dir>}
base=${2:-origin/main}

case $branch in
  bug/* | feature/* | task/* | bootstrap/* | docs/*) ;;
  *)
    echo "branch must be <kind>/<n> (task/12, bug/7, feature/3, bug/7-repro): got $branch" >&2
    exit 1
    ;;
esac

dir="$main_root/.worktrees/$(echo "$branch" | tr / -)"
if [ -e "$dir" ]; then
  echo "$dir already exists; use it (git worktree list)" >&2
  exit 1
fi

git -C "$main_root" fetch -q origin
if git -C "$main_root" show-ref --verify --quiet "refs/heads/$branch"; then
  git -C "$main_root" worktree add -q "$dir" "$branch" >&2
elif git -C "$main_root" show-ref --verify --quiet "refs/remotes/origin/$branch"; then
  git -C "$main_root" worktree add -q --track -b "$branch" "$dir" "origin/$branch" >&2
else
  git -C "$main_root" worktree add -q --no-track -b "$branch" "$dir" "$base" >&2
fi
prepare "$dir"

echo "$dir"
