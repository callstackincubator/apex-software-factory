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
#
# Shortcut (ADR 0009): a squash merge of a branch that was up to date with main produces a
# commit whose tree is byte-for-byte the tree of the PR's head commit. When the merged PR's head
# has a passing `check` and the trees are equal, the code CI would test is the code CI already
# tested, so this exits 0 at once. Anything less than that proof (no PR, another tree, no green
# check on the head) waits for CI on the merge commit as before.
set -euo pipefail

sha=${1:?usage: wait-for-check.sh <sha> [minutes]}
minutes=${2:-25}
deadline=$(($(date +%s) + minutes * 60))

tree_of() { gh api "repos/$GH_REPO/git/commits/$1" -q .tree.sha; }

proven_by_pr_head() {
  local pr head merged tree head_tree check
  pr=$(gh api "repos/$GH_REPO/commits/$sha/pulls" \
    -q "[.[] | select(.merged_at != null and .base.ref == \"main\" and .merge_commit_sha == \"$sha\")][0] | \"\(.number) \(.head.sha)\"" 2>/dev/null) || return 1
  [ -n "$pr" ] && [ "$pr" != "null null" ] || return 1
  head=${pr#* }
  merged=${pr%% *}
  tree=$(tree_of "$sha") || return 1
  head_tree=$(tree_of "$head") || return 1
  if [ "$tree" != "$head_tree" ]; then
    echo "Merge commit tree $tree differs from PR #$merged head tree $head_tree: waiting for CI on $sha"
    return 1
  fi
  # The newest `check` run on the PR head, from CI (the job name merge-pr.sh requires).
  check=$(gh api "repos/$GH_REPO/commits/$head/check-runs?check_name=check&per_page=20" \
    -q '[.check_runs[] | select(.app.slug == "github-actions")] | sort_by(.started_at) | last | "\(.status) \(.conclusion)"' 2>/dev/null) || return 1
  if [ "$check" != "completed success" ]; then
    echo "PR #$merged head ${head:0:7} has no passing check (${check:-none}): waiting for CI on $sha"
    return 1
  fi
  echo "CI proof: $sha has tree $tree, the tree of PR #$merged head ${head:0:7}, whose check passed. Not waiting for a second run on the same code."
  [ -z "${GITHUB_STEP_SUMMARY:-}" ] || echo "- CI: proven by PR #$merged head \`${head:0:7}\` (same tree, check passed); did not wait for CI on the merge commit." >>"$GITHUB_STEP_SUMMARY"
  return 0
}

if [ "${OTA_TREE_PROOF:-1}" != 0 ] && proven_by_pr_head; then
  exit 0
fi

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
