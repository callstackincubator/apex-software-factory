#!/usr/bin/env bash
# Waits for CI's `check` job on one commit and exits 0 only when it passed.
#
#   scripts/ci/wait-for-check.sh <sha> [minutes]     default 25 minutes
#
# env: GH_TOKEN (actions: read), GH_REPO.
#
# The merge gate already required `check` on the PR head, but the squash commit
# on main is a new tree (other merges may have landed in between), and a
# maintainer may push to main directly. The OTA publish ships to phones, so it
# ships only commits whose own CI run is green.
set -euo pipefail

sha=${1:?usage: wait-for-check.sh <sha> [minutes]}
minutes=${2:-25}
deadline=$(($(date +%s) + minutes * 60))

while :; do
  # Newest CI run for this commit (a re-run keeps its id; a new push is a new commit).
  run=$(gh run list --workflow ci.yml --commit "$sha" --limit 1 --json databaseId -q '.[0].databaseId // empty' || true)
  if [ -n "$run" ]; then
    job=$(gh run view "$run" --json jobs -q '.jobs[] | select(.name == "check") | "\(.status) \(.conclusion)"' || true)
    case $job in
      "completed success")
        echo "CI check passed on $sha (run $run)"
        exit 0
        ;;
      completed\ *)
        echo "::error title=CI check failed::check concluded '${job#completed }' on $sha (run $run). Not shipping a commit whose CI is not green."
        exit 1
        ;;
      *) echo "CI check on $sha: ${job:-not started} (run $run)" ;;
    esac
  else
    echo "No CI run for $sha yet"
  fi
  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "::error title=CI check did not finish::No passing check on $sha after $minutes minutes. Re-run this workflow once CI is green."
    exit 1
  fi
  sleep 15
done
