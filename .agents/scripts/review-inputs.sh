#!/usr/bin/env sh
# Prepares the blind inputs for the two pre-merge reviews of a PR (delivery rule 14).
#
#   .agents/scripts/review-inputs.sh <pr>
#
# Every reviewer runs on the same model as the implementer, so their independence comes only
# from what they can see. This script decides that mechanically, instead of trusting a prompt:
#
#   <main>/.worktrees/review-inputs/<pr>/spec-review/   diff.patch, issue.md, and when they
#       exist feature.md (a task's parent), triage.md (a bug's triage report), and spec/ with
#       every ADR the issue lists under Decisions and every rule file under Rules in play.
#       Never the rest of the rules, the PR body, commit messages or comments.
#   <main>/.worktrees/review-inputs/<pr>/code-review/   diff.patch, and rules/ with every file
#       in docs/internal/agent-rules/ plus the ADR index. Never the issue.
#   <main>/.worktrees/review-<pr>/                      a detached worktree of the PR head with
#       dependencies installed, for the code reviewer to run and break things in.
#
# Prints shell assignments for the caller: SPEC=, CODE=, WORKTREE=, ISSUE=, KIND= (code,
# adr-only, or no-spec when the PR closes no issue). Rules and the ADR index come from the
# base branch, so a PR cannot rewrite the rules it is judged by.
set -eu

pr=${1:?usage: review-inputs.sh <pr>}
here=$(cd "$(dirname "$0")" && pwd)
main_root=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
out="$main_root/.worktrees/review-inputs/$pr"
wt="$main_root/.worktrees/review-$pr"

head_ref=$(gh pr view "$pr" --json headRefName -q .headRefName)
base_ref=$(gh pr view "$pr" --json baseRefName -q .baseRefName)
git -C "$main_root" fetch -q origin "$base_ref" "pull/$pr/head:refs/review/$pr" --force
base="origin/$base_ref"
head="refs/review/$pr"

# The issue: the second segment of a <kind>/<n> branch, else the one the PR body closes.
issue=
case $head_ref in
  bug/* | feature/* | task/*)
    n=${head_ref#*/}
    case $n in '' | *[!0-9]*) ;; *) issue=$n ;; esac
    ;;
esac
if [ -z "$issue" ]; then
  issue=$(gh pr view "$pr" --json body -q .body \
    | grep -oiE '(close[sd]?|fix(e[sd])?|resolve[sd]?) #[0-9]+' | head -n 1 | grep -oE '[0-9]+' || true)
fi

rm -rf "$out"
mkdir -p "$out/spec-review/spec" "$out/code-review/rules"

git -C "$main_root" diff "$base...$head" >"$out/code-review/diff.patch"
cp "$out/code-review/diff.patch" "$out/spec-review/diff.patch"

for f in $(git -C "$main_root" ls-tree --name-only "$base" docs/internal/agent-rules/); do
  git -C "$main_root" show "$base:$f" >"$out/code-review/rules/$(basename "$f")"
done
git -C "$main_root" show "$base:docs/internal/adr/README.md" >"$out/code-review/rules/adr-index.md"

changed=$(git -C "$main_root" diff --name-only "$base...$head")
if printf '%s\n' "$changed" | grep -qv '^docs/internal/adr/'; then kind=code; else kind=adr-only; fi

if [ -n "$issue" ]; then
  gh issue view "$issue" --json body -q .body >"$out/spec-review/issue.md"
  labels=$(gh issue view "$issue" --json labels -q '.labels[].name')

  parent=$(gh api graphql -F owner='{owner}' -F repo='{repo}' -F number="$issue" -f query='
    query($owner:String!,$repo:String!,$number:Int!){
      repository(owner:$owner,name:$repo){ issue(number:$number){ parent{ number } } } }' \
    -q '.data.repository.issue.parent.number // empty')
  if [ -n "$parent" ]; then
    gh issue view "$parent" --json body -q .body >"$out/spec-review/feature.md"
  fi

  if printf '%s\n' "$labels" | grep -q '^bug:'; then
    gh issue view "$issue" --json comments \
      -q '[.comments[] | select(.body | test("^## Root cause"; "m"))] | last | .body // empty' \
      >"$out/spec-review/triage.md"
    [ -s "$out/spec-review/triage.md" ] || rm -f "$out/spec-review/triage.md"
  fi

  # ADRs under Decisions and rule files under Rules in play, from the issue and its parent.
  refs=$(cat "$out/spec-review/issue.md" "$out/spec-review/feature.md" 2>/dev/null | node -e '
    let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
      const adrs = new Set(), rules = new Set();
      for (const m of s.matchAll(/ADR[ -]?(\d{4})/g)) adrs.add(m[1]);
      const play = [...s.matchAll(/^###? Rules in play\s*$([\s\S]*?)(?=^#{1,3} |(?![\s\S]))/gm)].map((m) => m[1]).join("\n");
      for (const m of play.matchAll(/([a-z][a-z-]*)\.md/g)) rules.add(m[1]);
      for (const a of adrs) console.log(`adr ${a}`);
      for (const r of rules) console.log(`rule ${r}`);
    });')
  printf '%s\n' "$refs" | while read -r what name; do
    case $what in
      adr)
        path=$(git -C "$main_root" ls-tree --name-only "$head" docs/internal/adr/ | grep "/$name-" | head -n 1 || true)
        [ -n "$path" ] && git -C "$main_root" show "$head:$path" >"$out/spec-review/spec/$(basename "$path")"
        ;;
      rule)
        git -C "$main_root" show "$base:docs/internal/agent-rules/$name.md" \
          >"$out/spec-review/spec/$name.md" 2>/dev/null || rm -f "$out/spec-review/spec/$name.md"
        ;;
    esac
  done
else
  kind=no-spec
  rm -rf "$out/spec-review"
fi

if [ "$kind" != adr-only ]; then
  if [ -e "$wt" ]; then git -C "$main_root" worktree remove --force "$wt"; fi
  git -C "$main_root" worktree add -q --detach "$wt" "$head" >&2
  "$here/worktree.sh" --prepare "$wt" >&2
else
  wt=
fi

echo "SPEC=$([ -d "$out/spec-review" ] && echo "$out/spec-review")"
echo "CODE=$out/code-review"
echo "WORKTREE=$wt"
echo "ISSUE=$issue"
echo "KIND=$kind"
