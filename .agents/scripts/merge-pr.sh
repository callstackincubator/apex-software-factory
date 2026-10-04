#!/usr/bin/env sh
# Merges a delivery PR only when its mechanical gates pass (delivery rule 15).
#
#   .agents/scripts/merge-pr.sh <pr> [minutes]     minutes to wait for pending checks, default 30
#
# Gates, in order: the PR is open and not a draft; it carries neither `needs-simulator` nor
# `needs-native-build`; its body has a `## Review` section with the review stage's result line
# and no "spec needs" line; its diff changes nothing native (native-check.sh), because a native
# change cannot ship over the air; the required check CI/check (`pnpm check`) reported and
# passed, and every other CI check passed or was skipped; and GitHub calls it mergeable. Waits
# up to [minutes] for pending or not-yet-reported checks. Prints the first gate that fails and
# exits 1, or exits 2 when checks are still pending at the deadline (run it again to wait on).
#
# Agents may not run `gh pr merge` themselves (opencode.json denies it); this script is the one
# place a delivery PR is merged from. It squash-merges, so main gets one commit per issue.
set -eu

pr=${1:?usage: merge-pr.sh <pr> [minutes]}
minutes=${2:-30}
here=$(dirname "$0")
fail() {
  echo "not merged: $*" >&2
  exit 1
}

view() { gh pr view "$pr" --json "$1" -q "$2"; }

[ "$(view state .state)" = OPEN ] || fail "PR #$pr is not open"
[ "$(view isDraft .isDraft)" = false ] || fail "PR #$pr is still a draft"
labels=$(view labels '.labels[].name')
for parked in needs-simulator needs-native-build; do
  printf '%s\n' "$labels" | grep -qx "$parked" && fail "PR #$pr is labelled $parked"
done
body=$(view body .body)
printf '%s\n' "$body" | grep -q '^## Review' || fail "PR #$pr has no ## Review section"
# The PR template carries an empty Review heading; only the review stage writes this line.
printf '%s\n' "$body" | grep -q '^Spec review: .*Code review: ' \
  || fail "PR #$pr has no review result (a 'Spec review: ... Code review: ...' line under ## Review)"
printf '%s\n' "$body" | grep -qi 'spec needs' && fail "PR #$pr says the spec needs a change"

base=$(view baseRefName .baseRefName)
git fetch -q --force origin "$base" "pull/$pr/head:refs/gate/$pr"
if ! native=$("$here/native-check.sh" "origin/$base" "refs/gate/$pr"); then
  fail "PR #$pr changes native code and cannot ship over the air: $(printf '%s\n' "$native" | grep '^native:' | tr '\n' ';')"
fi

# Checks are "<bucket> <workflow>/<job>". The required ones must report and pass: right after a
# push GitHub lists only the checks that have started, and "every listed check passed" would
# let a PR through before CI even ran. CI/check is `pnpm check` (.github/workflows/ci.yml).
required="CI/check"
bucket_of() { printf '%s\n' "$checks" | awk -v want="$1" '{ b = $1; sub(/^[^ ]+ /, ""); if ($0 == want) print b }'; }
deadline=$(($(date +%s) + minutes * 60))
while :; do
  checks=$(gh pr checks "$pr" --json name,bucket,workflow -q '.[] | "\(.bucket) \(.workflow)/\(.name)"' || true)
  missing=
  for req in $required; do
    [ -n "$(bucket_of "$req")" ] || missing="$missing $req"
  done
  [ -z "$missing" ] && ! printf '%s\n' "$checks" | grep -q '^pending ' && break
  [ "$(date +%s)" -lt "$deadline" ] || {
    [ -z "$missing" ] || fail "required check(s)$missing never reported after $minutes minutes"
    echo "not merged: checks still pending after $minutes minutes; run again to keep waiting" >&2
    exit 2
  }
  sleep 30
done
for req in $required; do
  [ "$(bucket_of "$req" | sort -u)" = pass ] || fail "required check $req did not pass: $(bucket_of "$req" | tr '\n' ' ')"
done
bad=$(echo "$checks" | grep -v -e '^pass ' -e '^skipping ' || true)
[ -z "$bad" ] || fail "CI not green: $(echo "$bad" | tr '\n' ';')"

# GitHub computes mergeability lazily; UNKNOWN settles within seconds.
mergeable=UNKNOWN
for _ in 1 2 3 4 5 6; do
  mergeable=$(view mergeable .mergeable)
  [ "$mergeable" = UNKNOWN ] || break
  sleep 5
done
[ "$mergeable" = MERGEABLE ] || fail "GitHub reports PR #$pr as $mergeable"

out=$(gh pr merge "$pr" --squash 2>&1) || fail "$out"
echo "merged #$pr"
