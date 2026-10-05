#!/usr/bin/env sh
# Claims an issue, or releases the claim (ADR 0020). The claim is the issue's work branch on
# origin: task/<n>, feature/<n>, bug/<n>, or bug/<n>-repro for a triage. GitHub refuses to
# create a ref that exists, so two agents cannot both claim one issue.
#
#   .agents/scripts/claim.sh <branch>              claim: create <branch> on origin
#   .agents/scripts/claim.sh --release <branch>    release: delete <branch> if it carries no work
#
# A claim starts at main; bug/<n> starts at bug/<n>-repro when that exists, so the triage test
# is carried forward. A release deletes the branch only when it has no commit main lacks. A
# branch with work stays as the other half of the handoff: the issue stays claimed until the
# work merges or a person deletes the branch, and the next run continues from it.
#
# Exit: 0 claimed, released, or kept (the message says which); 3 <branch> already exists (an
# earlier run's work or someone else's claim: the caller decides); 1 GitHub failed; 64 usage.
set -eu

release=
if [ "${1:-}" = --release ]; then
  release=1
  shift
fi
branch=${1:-}
case $branch in
  task/[0-9]* | feature/[0-9]* | bug/[0-9]*) ;;
  *)
    sed -n '2,15p' "$0" >&2
    exit 64
    ;;
esac

repo=repos/{owner}/{repo}
head_of() { gh api "$repo/git/ref/heads/$1" -q .object.sha 2>/dev/null; }

if [ -n "$release" ]; then
  head_of "$branch" >/dev/null || { echo "released: $branch does not exist"; exit 0; }
  ahead=$(gh api "$repo/compare/main...$branch" -q .ahead_by) || { echo "claim: cannot compare $branch with main" >&2; exit 1; }
  if [ "$ahead" -gt 0 ]; then
    echo "kept: $branch carries $ahead commit(s) main lacks; the issue stays claimed"
    exit 0
  fi
  gh api --method DELETE "$repo/git/refs/heads/$branch" --silent || { echo "claim: cannot delete $branch" >&2; exit 1; }
  echo "released: $branch deleted (no work on it)"
  exit 0
fi

exists() {
  ahead=$(gh api "$repo/compare/main...$branch" -q .ahead_by 2>/dev/null || echo "?")
  echo "exists: $branch, $ahead commit(s) ahead of main"
  exit 3
}
head_of "$branch" >/dev/null && exists

base=main
case $branch in bug/*[0-9]) head_of "$branch-repro" >/dev/null && base=$branch-repro ;; esac
sha=$(head_of "$base") || { echo "claim: cannot read $base" >&2; exit 1; }
if ! gh api "$repo/git/refs" -f ref="refs/heads/$branch" -f sha="$sha" --silent 2>/dev/null; then
  head_of "$branch" >/dev/null && exists # another agent won the race
  echo "claim: cannot create $branch" >&2
  exit 1
fi
echo "claimed: $branch created from $base"
