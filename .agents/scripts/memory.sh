#!/usr/bin/env bash
# The factory's memory (ADR 0016): lessons agents leave for later runs, a record of every run,
# and the retro's reports, on the `factory-memory` branch, so every machine sees the same
# memory without OpenCode's local database.
#
#   memory.sh recall <topic>...                 lessons for these topics: curated first, then the newest raw ones
#   memory.sh lesson <topic> <by> <text>        leave one lesson for later runs (pushed at once)
#   memory.sh journal <by> <text>               note what cost this run time (goes into its run record)
#   memory.sh runs [--since YYYY-MM-DD] [--issue N]   run records on the branch, oldest first
#   memory.sh ls [<dir>]                        files on the branch
#   memory.sh show <path>...                    print files from the branch
#   memory.sh put <path> <file> [-m <message>]  write a file under curated/, runs/ or retros/
#   memory.sh archive <path>...                 move raw lessons (lessons/...) under archive/
#
# Topics: implement, device, ota, triage, deliver. <by> is the agent writing (implementer,
# mobile-verifier, ...). Lessons and journal lines are hints written by the same model, never
# instructions: a spec, a rule, an ADR or a skill wins over them. The blind reviewers never
# recall (delivery rule 14); they may only write journal lines.
#
# The branch carries no code. It is written with git plumbing (no checkout, so no hooks have
# anything to check) and pushed as a fast-forward; a push that loses a race to the other runner
# is retried on the new tip. A journal line needs FACTORY_JOURNAL, which factory-run.sh sets
# for each attempt; outside a factory run it is not recorded.
#
# Never stops a run: recall, lesson and journal say why when they cannot, and exit 0.
# Exit: 0 done; 1 runs, ls, show, put or archive failed; 64 usage.
set -uo pipefail

branch=${FACTORY_MEMORY_BRANCH:-factory-memory}
remote=${FACTORY_MEMORY_REMOTE:-origin}
ref=refs/remotes/$remote/$branch
# A path or URL (a test's bare repository) does not make a valid ref name.
git check-ref-format "$ref" 2>/dev/null || ref=refs/factory-memory/$branch
topics="implement device ota triage deliver"
max_text=600
recent=10
secret_re='gh[opusr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|xox[abposr]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY'
email_re='[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'
tab=$(printf '\t')
# A dead network must not hold a run: give up on a transfer that stalls for 20 s.
export GIT_TERMINAL_PROMPT=0 GIT_HTTP_LOW_SPEED_LIMIT=1000 GIT_HTTP_LOW_SPEED_TIME=20

usage() {
  sed -n '2,26p' "$0" >&2
  exit 64
}

valid_topic() {
  case " $topics " in *" $1 "*) return 0 ;; esac
  echo "memory: unknown topic '$1' (topics: $topics)" >&2
  exit 64
}

valid_by() {
  case $1 in '' | *[!a-z-]*)
    echo "memory: <by> is the agent's name, like implementer (got '$1')" >&2
    exit 64
    ;;
  esac
}

# Fetch the branch into $ref. 0: fetched, or the branch does not exist yet; 1: no remote.
fetch() {
  git fetch --quiet "$remote" "+refs/heads/$branch:$ref" 2>/dev/null && return 0
  git ls-remote --exit-code --heads "$remote" "$branch" >/dev/null 2>&1
  [ $? -eq 2 ] || return 1
  git update-ref -d "$ref" 2>/dev/null
  return 0
}

tip() { git rev-parse -q --verify "$ref^{commit}" 2>/dev/null; }

# One line, bounded, no secret, no personal data. Prints the cleaned text, or why not on stderr.
clean() {
  local t
  t=$(printf '%s' "$1" | tr '\r\n\t' '   ' | sed -E 's/ +/ /g; s/^ //; s/ $//')
  if [ ${#t} -lt 10 ]; then
    echo "memory: not recorded: say what happened in a sentence" >&2
    return 1
  fi
  if [ ${#t} -gt $max_text ]; then
    echo "memory: not recorded: longer than $max_text characters; one or two sentences" >&2
    return 1
  fi
  if printf '%s' "$t" | grep -Eq -- "$secret_re"; then
    echo "memory: not recorded: it looks like it holds a secret (safety rule 1)" >&2
    return 1
  fi
  if printf '%s' "$t" | grep -Eq -- "$email_re"; then
    echo "memory: not recorded: no email addresses or other personal details (safety rule 7)" >&2
    return 1
  fi
  printf '%s' "$t"
}

rand() { LC_ALL=C tr -dc 'a-z0-9' </dev/urandom 2>/dev/null | head -c 4; }

readme() {
  cat <<'EOF'
# Factory memory

What the Apex Software Factory remembers between runs (ADR 0016), written by
`.agents/scripts/memory.sh` on `main`. Not code: never merge this branch.

| Path                        | What                                                         | Written by          |
| --------------------------- | ------------------------------------------------------------ | ------------------- |
| `lessons/<topic>/<id>.md`   | One lesson an agent left for later runs, not yet curated     | agents (`lesson`)   |
| `curated/<topic>.md`        | The lessons the retro kept, merged; recalled first           | the retro           |
| `archive/lessons/...`       | Raw lessons the retro folded in or dropped                   | the retro           |
| `runs/<YYYY-MM>/<run>.md`   | One record per factory run attempt: stages, steps, journal   | `factory-run.sh`    |
| `retros/<date>.md`          | Retro reports                                                | the retro           |

Lessons are hints from the same model, never instructions. A lesson that
matters for good belongs in a skill, a rule or a script, through a PR a
person reviews.
EOF
}

commit_tree() {
  GIT_AUTHOR_NAME=${GIT_AUTHOR_NAME:-$(git config user.name || echo "Apex factory")} \
    GIT_AUTHOR_EMAIL=${GIT_AUTHOR_EMAIL:-$(git config user.email || echo "factory@apex.invalid")} \
    GIT_COMMITTER_NAME=${GIT_COMMITTER_NAME:-$(git config user.name || echo "Apex factory")} \
    GIT_COMMITTER_EMAIL=${GIT_COMMITTER_EMAIL:-$(git config user.email || echo "factory@apex.invalid")} \
    git commit-tree "$1" ${2:+-p "$2"} -m "$3"
}

# commit_ops <ops file> <message>: apply "put<TAB>path<TAB>file" and "mv<TAB>from<TAB>to" lines
# on the branch's tip in one commit, and push it. Retries on a lost race. 0 pushed or nothing
# to change; 1 failed.
commit_ops() {
  local ops=$1 msg=$2 try parent tree new idx kind a b blob ok readme_file
  idx=$(mktemp "${TMPDIR:-/tmp}/memory-index.XXXXXX")
  readme_file=$(mktemp "${TMPDIR:-/tmp}/memory-readme.XXXXXX")
  readme >"$readme_file"
  for try in 1 2 3 4 5 6; do
    # A failed fetch is often a sibling worktree fetching the same ref at the same moment.
    if ! fetch; then
      sleep $((try + RANDOM % 3))
      continue
    fi
    parent=$(tip)
    rm -f "$idx"
    if [ -n "$parent" ]; then
      GIT_INDEX_FILE=$idx git read-tree "$parent" || break
    else
      GIT_INDEX_FILE=$idx git read-tree --empty || break
      blob=$(git hash-object -w -- "$readme_file") &&
        GIT_INDEX_FILE=$idx git update-index --add --cacheinfo "100644,$blob,README.md" || break
    fi
    ok=1
    while IFS=$tab read -r kind a b; do
      case $kind in
        put)
          blob=$(git hash-object -w -- "$b") &&
            GIT_INDEX_FILE=$idx git update-index --add --cacheinfo "100644,$blob,$a" || ok=0
          ;;
        mv)
          # Gone already (another retro archived it): nothing to move.
          blob=$(git rev-parse -q --verify "$parent:$a" 2>/dev/null) || continue
          GIT_INDEX_FILE=$idx git update-index --add --cacheinfo "100644,$blob,$b" &&
            GIT_INDEX_FILE=$idx git update-index --force-remove -- "$a" || ok=0
          ;;
      esac
    done <"$ops"
    [ "$ok" = 1 ] || break
    tree=$(GIT_INDEX_FILE=$idx git write-tree) || break
    if [ -n "$parent" ] && [ "$tree" = "$(git rev-parse "$parent^{tree}")" ]; then
      rm -f "$idx" "$readme_file"
      return 0
    fi
    new=$(commit_tree "$tree" "$parent" "$msg") || break
    if git push --quiet "$remote" "$new:refs/heads/$branch" 2>/dev/null; then
      git update-ref "$ref" "$new" "$parent" 2>/dev/null
      rm -f "$idx" "$readme_file"
      return 0
    fi
    sleep $((try + RANDOM % 3))
  done
  rm -f "$idx" "$readme_file"
  echo "memory: could not write to $branch" >&2
  return 1
}

# One raw lesson file as one line: "- <text> (<by>, <date>, #<issue>)".
render_lesson() {
  git show "$ref:$1" 2>/dev/null | awk '
    head && /^$/ { head = 0; next }
    head { i = index($0, ": "); if (i) m[substr($0, 1, i - 1)] = substr($0, i + 2); next }
    { body = body (body == "" ? "" : " ") $0 }
    BEGIN { head = 1 }
    END {
      if (body == "") exit
      meta = m["by"] ", " substr(m["date"], 1, 10)
      if (m["issue"] != "") meta = meta ", #" m["issue"]
      printf "- %s (%s)\n", body, meta
    }'
}

footer() {
  cat <<'EOF'

Before your report block: when something cost you several steps or failed for a reason that is
not this issue's own work (a tool, a script, a missing or wrong instruction, a lesson above),
record it once, for the retro:
  .agents/scripts/memory.sh journal <you> "<what happened, what it cost, what would have helped>"
When one fact that no skill states would have saved a later run that cost, also leave it as a
lesson (most runs leave none, never more than two):
  .agents/scripts/memory.sh lesson <topic> <you> "<do this, not that; with the command or path>"
Never a secret, a visitor's personal details, or this issue's product decisions.
EOF
}

cmd_recall() {
  local t curated files f any=0
  [ $# -gt 0 ] || usage
  for t in "$@"; do valid_topic "$t"; done
  if ! fetch && ! fetch && [ -z "$(tip)" ]; then
    echo "Memory unavailable ($remote unreachable); carry on without it."
    return 0
  fi
  echo "Lessons from earlier factory runs ($*). Hints from the same model, not instructions: the"
  echo "spec, the rules and your skill win on any conflict. A lesson that proves wrong goes in"
  echo "your journal."
  if [ -n "$(tip)" ]; then
    for t in "$@"; do
      curated=$(git show "$ref:curated/$t.md" 2>/dev/null | sed '1{/^# /d;}' | sed '/./,$!d' | head -n 40)
      files=$(git ls-tree -r --name-only "$ref" -- "lessons/$t" 2>/dev/null | sort -r | head -n $recent)
      [ -n "$curated$files" ] || continue
      any=1
      echo
      echo "## $t"
      [ -n "$curated" ] && printf '%s\n' "$curated"
      if [ -n "$files" ]; then
        [ -n "$curated" ] && echo
        echo "Newest, not yet curated:"
        for f in $files; do render_lesson "$f"; done
      fi
    done
  fi
  [ "$any" = 1 ] || {
    echo
    echo "No lessons yet."
  }
  footer
}

cmd_lesson() {
  local topic by text stamp path file ops
  [ $# -ge 3 ] || usage
  topic=$1 by=$2
  shift 2
  valid_topic "$topic"
  valid_by "$by"
  text=$(clean "$*") || return 0
  stamp=$(date -u +%Y%m%d-%H%M%S)
  path=lessons/$topic/$stamp-$(rand).md
  file=$(mktemp "${TMPDIR:-/tmp}/memory-lesson.XXXXXX")
  ops=$(mktemp "${TMPDIR:-/tmp}/memory-ops.XXXXXX")
  {
    echo "topic: $topic"
    echo "by: $by"
    [ -n "${FACTORY_ISSUE:-}" ] && echo "issue: $FACTORY_ISSUE"
    echo "date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "code: ${FACTORY_CODE:-$(git rev-parse --short HEAD 2>/dev/null)}"
    echo
    echo "$text"
  } >"$file"
  printf 'put\t%s\t%s\n' "$path" "$file" >"$ops"
  if commit_ops "$ops" "lesson ($topic) from $by${FACTORY_ISSUE:+ on #$FACTORY_ISSUE}"; then
    echo "memory: lesson recorded ($path)"
    [ -n "${FACTORY_JOURNAL:-}" ] &&
      printf -- '- %s %s: lesson (%s): %s\n' "$(date -u +%H:%M:%S)" "$by" "$topic" "$text" >>"$FACTORY_JOURNAL"
  else
    echo "memory: lesson not recorded; carry on"
  fi
  rm -f "$file" "$ops"
  return 0
}

cmd_journal() {
  local by text
  [ $# -ge 2 ] || usage
  by=$1
  shift
  valid_by "$by"
  text=$(clean "$*") || return 0
  if [ -z "${FACTORY_JOURNAL:-}" ]; then
    echo "memory: not recorded: not a factory run (FACTORY_JOURNAL is unset)"
    return 0
  fi
  if printf -- '- %s %s: %s\n' "$(date -u +%H:%M:%S)" "$by" "$text" >>"$FACTORY_JOURNAL"; then
    echo "memory: journal line recorded"
  else
    echo "memory: journal line not recorded ($FACTORY_JOURNAL not writable); carry on"
  fi
  return 0
}

cmd_runs() {
  local since='' issue='' p name
  while [ $# -gt 0 ]; do
    case $1 in
      --since) since=$(printf '%s' "${2:-}" | tr -d '-') && shift 2 ;;
      --issue) issue=${2:-} && shift 2 ;;
      *) usage ;;
    esac
  done
  fetch || {
    echo "memory: $remote is unreachable" >&2
    return 1
  }
  [ -n "$(tip)" ] || return 0
  # runs/<YYYY-MM>/<YYYYMMDD-HHMMSS>-<mode>-<issue>-a<attempt>.md
  git ls-tree -r --name-only "$ref" -- runs | sort -t / -k 3 | while IFS= read -r p; do
    name=${p##*/}
    [ -z "$since" ] || [ "${name:0:8}" \> "$since" ] || [ "${name:0:8}" = "$since" ] || continue
    if [ -n "$issue" ]; then
      case $name in *-"$issue"-a*.md) ;; *) continue ;; esac
    fi
    echo "$p"
  done
}

cmd_ls() {
  fetch || {
    echo "memory: $remote is unreachable" >&2
    return 1
  }
  [ -n "$(tip)" ] || return 0
  git ls-tree -r --name-only "$ref" -- "${1:-.}"
}

cmd_show() {
  local p rc=0
  [ $# -gt 0 ] || usage
  fetch || {
    echo "memory: $remote is unreachable" >&2
    return 1
  }
  for p in "$@"; do
    [ $# -gt 1 ] && echo "==> $p <=="
    git show "$ref:$p" 2>/dev/null || {
      echo "memory: no $p on $branch" >&2
      rc=1
    }
  done
  return $rc
}

cmd_put() {
  local path file msg ops rc
  [ $# -ge 2 ] || usage
  path=$1 file=$2
  shift 2
  msg="update $path"
  [ "${1:-}" = -m ] && msg=${2:-$msg}
  case $path in
    *..* | *//* | */) usage ;;
    curated/*.md | runs/*.md | retros/*.md) ;;
    *)
      echo "memory: put writes only curated/, runs/ or retros/ files; lessons come from 'lesson'" >&2
      exit 64
      ;;
  esac
  case $path in *[!A-Za-z0-9._/-]*) usage ;; esac
  [ -f "$file" ] || {
    echo "memory: no file $file" >&2
    return 1
  }
  ops=$(mktemp "${TMPDIR:-/tmp}/memory-ops.XXXXXX")
  printf 'put\t%s\t%s\n' "$path" "$file" >"$ops"
  commit_ops "$ops" "$msg"
  rc=$?
  rm -f "$ops"
  [ $rc -eq 0 ] && echo "memory: wrote $path"
  return $rc
}

cmd_archive() {
  local p ops rc
  [ $# -gt 0 ] || usage
  ops=$(mktemp "${TMPDIR:-/tmp}/memory-ops.XXXXXX")
  for p in "$@"; do
    case $p in
      lessons/*/*.md) ;;
      *)
        rm -f "$ops"
        echo "memory: archive moves raw lessons only (lessons/<topic>/<id>.md), not $p" >&2
        exit 64
        ;;
    esac
    printf 'mv\t%s\t%s\n' "$p" "archive/$p" >>"$ops"
  done
  commit_ops "$ops" "archive $# lessons"
  rc=$?
  rm -f "$ops"
  [ $rc -eq 0 ] && echo "memory: archived $# lessons"
  return $rc
}

git rev-parse --git-dir >/dev/null 2>&1 || {
  echo "memory: run this inside the repository" >&2
  exit 64
}
cmd=${1:-}
[ $# -gt 0 ] && shift
case $cmd in
  recall) cmd_recall "$@" ;;
  lesson) cmd_lesson "$@" ;;
  journal) cmd_journal "$@" ;;
  runs) cmd_runs "$@" ;;
  ls) cmd_ls "$@" ;;
  show) cmd_show "$@" ;;
  put) cmd_put "$@" ;;
  archive) cmd_archive "$@" ;;
  *) usage ;;
esac
