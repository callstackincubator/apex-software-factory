#!/usr/bin/env bash
# One unattended factory run on one issue, with a watchdog (ADR 0012).
#
#   .agents/scripts/factory-run.sh <issue>             deliver #<issue> (the factory agent)
#   .agents/scripts/factory-run.sh --triage <issue>    triage #<issue> (the triager agent)
#
# Wraps `opencode run --standalone --auto` (a private server: the run inherits this shell's
# environment, SIMLOCK_BIN included) and watches it. `opencode run --agent` ignores the agent's
# own `variant` (it sent the model's default effort), so the script passes the agent file's
# `model` and `variant` as `-m <model>#<variant>` (ADR 0008):
#   - hard timeout: FACTORY_TIMEOUT_MIN (default 80) minutes for the whole run;
#   - no progress: FACTORY_STALL_MIN (default 15) minutes in which no session this run started
#     (the run's own or a subagent's) wrote to OpenCode's database
#     (~/.local/share/opencode/opencode.db: session_v2 / session_message time_updated) and the
#     run's log did not grow. Longer than the longest single legitimate wait (merge-pr.sh 9
#     minutes, a simlock lease call 9 minutes).
# A run that stalls or times out is stopped and started once more, from the branch: the deliver
# skill resumes from GitHub (claim, branch, PR Status line). If the second attempt stops too,
# this script leaves the issue's `## Handoff` (delivery rule 2), releases the claim and moves it
# to <kind>:blocked, or says why it could not.
#
# An attempt whose agent turn ended on a provider error, or whose last turn hit the output limit
# or came back with no text (a garbled reply; OpenCode exits 0 for both) counts as stopped too,
# and is restarted the same way after a short backoff.
#
# After every attempt, run-record.sh writes the attempt's record (ADR 0016): a digest of every
# stage from OpenCode's database, pushed to the memory branch, and the redacted transcript next
# to the log, which factory.yml uploads as the run's artifact. FACTORY_JOURNAL points the
# attempt's agents at <log>.journal.md for `memory.sh journal`.
#
# Exit: 0 the run ended on its own (merged, parked or reported — read the issue); 1 gave up
# after the restart; 64 usage; 69 opencode or sqlite3 missing, or the agent file names no model.
# Logs: <checkout>/.worktrees/factory-runs/<issue>-<attempt>-<time>.log, with .journal.md,
# .digest.md and .transcript.jsonl.gz beside it.
set -uo pipefail

mode=deliver
if [ "${1:-}" = --triage ]; then
  mode=triage
  shift
fi
issue=${1:-}
case $issue in '' | *[!0-9]*)
  sed -n '2,22p' "$0" >&2
  exit 64
  ;;
esac

command -v opencode >/dev/null 2>&1 || { echo "unavailable: opencode not on PATH" >&2; exit 69; }
command -v sqlite3 >/dev/null 2>&1 || { echo "unavailable: sqlite3 not on PATH" >&2; exit 69; }

root=$(git rev-parse --show-toplevel)
cd "$root" || exit 1
db=${OPENCODE_DB:-$HOME/.local/share/opencode/opencode.db}
timeout_min=${FACTORY_TIMEOUT_MIN:-80}
stall_min=${FACTORY_STALL_MIN:-15}
logs="$root/.worktrees/factory-runs"
mkdir -p "$logs"
# ADR 0019: no global skills. OpenCode adds every skill under ~/.claude and ~/.agents to each
# agent's system prompt (74 on this Mac, 31 KB), and that prompt shape made the endpoint garble
# the mobile-verifier's first turn. OPENCODE_TEST_HOME moves only the home OpenCode searches;
# auth, the database, ~/.config/opencode and the tools' own HOME are unchanged.
export OPENCODE_TEST_HOME="$root/.worktrees/opencode-home"
mkdir -p "$OPENCODE_TEST_HOME"
started=$(date +%s)
deadline=$((started + timeout_min * 60))

if [ "$mode" = deliver ]; then
  agent=factory
  first="deliver #$issue"
else
  agent=triager
  first="triage #$issue"
fi

# The agent file's `model:` and `variant:`, as `-m` takes them: provider/model#variant.
frontmatter() { sed -n "/^---\$/,/^---\$/s/^$1: *//p" ".opencode/agent/$agent.md" | head -n 1; }
model=$(frontmatter model)
variant=$(frontmatter variant)
[ -n "$model" ] || { echo "unavailable: no model in .opencode/agent/$agent.md" >&2; exit 69; }
model_arg=$model${variant:+#$variant}
# For memory.sh and run-record.sh, in this script and in every agent the run starts.
FACTORY_ISSUE=$issue FACTORY_MODE=$mode FACTORY_MODEL=$model_arg FACTORY_CODE=$(git rev-parse --short HEAD)
export FACTORY_ISSUE FACTORY_MODE FACTORY_MODEL FACTORY_CODE

now_ms() { echo $(($(date +%s) * 1000)); }

# Newest write by any session created since $1 (ms) in this checkout or below it.
last_write_ms() {
  sqlite3 -readonly "$db" "
    select max(t) from (
      select max(s.time_updated) as t from session_v2 s
        where s.time_created >= $1 and (s.directory = '$root' or s.directory like '$root/%')
      union all
      select max(m.time_updated) from session_message m join session_v2 s on s.id = m.session_id
        where s.time_created >= $1 and (s.directory = '$root' or s.directory like '$root/%')
    );" 2>/dev/null || true
}

# record <attempt> <since-ms> <log> [<stopped reason>]: the attempt's run record; never fatal.
record() {
  "$root/.agents/scripts/run-record.sh" "$issue" "$mode" "$1" "$agent" "$2" "$3" "${4:-}" >&2 ||
    echo "factory-run: no run record for attempt $1" >&2
}

size_of() { stat -f %z "$1" 2>/dev/null || stat -c %s "$1" 2>/dev/null || echo 0; }

# run_attempt <n> <prompt>: 0 ended on its own, 124 timed out, 125 stalled.
run_attempt() {
  local n=$1 prompt=$2 log pid since last_ms last_size last_seen now size w reason
  log="$logs/$issue-$n-$(date +%Y%m%d-%H%M%S).log"
  since=$(now_ms)
  echo "factory-run: #$issue $mode attempt $n ($model_arg), log $log" >&2
  export FACTORY_JOURNAL="$log.journal.md"
  opencode run --standalone --agent "$agent" -m "$model_arg" --auto --title "factory $mode #$issue (attempt $n)" \
    "$prompt" >"$log" 2>&1 &
  pid=$!
  last_seen=$(date +%s)
  last_ms=0
  last_size=0
  while kill -0 "$pid" 2>/dev/null; do
    sleep 20
    now=$(date +%s)
    w=$(last_write_ms "$since")
    size=$(size_of "$log")
    if { [ -n "$w" ] && [ "$w" -gt "$last_ms" ]; } || [ "$size" -gt "$last_size" ]; then
      last_seen=$now
      [ -n "$w" ] && last_ms=$w
      last_size=$size
    fi
    reason=
    [ "$now" -ge "$deadline" ] && reason="hard timeout (${timeout_min} min for the run)"
    [ $((now - last_seen)) -ge $((stall_min * 60)) ] && reason="no progress for ${stall_min} min"
    if [ -n "$reason" ]; then
      echo "factory-run: #$issue attempt $n stopped: $reason" >&2
      echo "$reason" >"$log.stopped"
      kill -TERM "$pid" 2>/dev/null
      sleep 10
      kill -KILL "$pid" 2>/dev/null
      wait "$pid" 2>/dev/null
      record "$n" "$since" "$log" "$reason"
      case $reason in hard*) return 124 ;; *) return 125 ;; esac
    fi
  done
  wait "$pid"
  echo "factory-run: #$issue attempt $n ended (opencode exit $?) after $(($(date +%s) - started))s" >&2
  tail -n 15 "$log" >&2
  top=$(sqlite3 -readonly "$db" "
    select id from session_v2 where parent_id is null and agent = '$agent'
      and time_created >= $since and (directory = '$root' or directory like '$root/%')
      order by time_created desc limit 1;" 2>/dev/null || true)
  # `opencode run` exits 0 even when the agent's turn ended on an error (a 503 from the
  # provider, "no upstreams available"): the run stopped, it did not finish. OpenCode records
  # it as the top session's last event, `idle` with outcome "failed".
  outcome=$(sqlite3 -readonly "$db" "
    select json_extract(data, '\$.outcome') from session_message
      where session_id = '$top' and type = 'idle' order by seq desc limit 1;" 2>/dev/null || true)
  # It also exits 0, outcome "succeeded", when the last turn was garbled: it ran to the output
  # limit (finish "length") or ended with no text at all (#18's run on 2026-10-05). A run that
  # finished on its own ends with a text reply (the end-of-run comment's summary, a handoff).
  last=$(sqlite3 -readonly "$db" "
    select json_extract(m.data, '\$.finish') || '|' || coalesce((select count(*) from json_each(m.data, '\$.content') c
                where json_extract(c.value, '\$.type') = 'text' and trim(json_extract(c.value, '\$.text')) <> ''), 0)
      from session_message m where m.session_id = '$top' and m.type = 'assistant' order by m.seq desc limit 1;" 2>/dev/null || true)
  reason=
  if [ "$outcome" = failed ]; then
    error=$(grep -oE 'ServiceUnavailable[A-Za-z]*|no upstreams available|"status":5[0-9][0-9]' "$log" | tail -n 1)
    reason="the agent's turn ended on an error${error:+ ($error)}"
  elif [ -n "$top" ] && [ -n "$last" ] && { [ "${last%%|*}" = length ] || [ "${last#*|}" = 0 ]; }; then
    reason="the agent's last turn came back garbled (finish ${last%%|*}, ${last#*|} text parts)"
  fi
  record "$n" "$since" "$log" "$reason"
  if [ -n "$reason" ]; then
    echo "factory-run: #$issue attempt $n stopped: $reason" >&2
    echo "$reason" >"$log.stopped"
    sleep "${FACTORY_ERROR_BACKOFF_S:-60}" # a provider outage is usually short
    return 126
  fi
  return 0
}

run_attempt 1 "$first"
code=$?
[ "$code" -eq 0 ] && exit 0
first_reason=$(cat "$logs"/"$issue"-1-*.log.stopped 2>/dev/null | tail -n 1)
second_reason=

if [ "$(date +%s)" -lt "$deadline" ]; then
  run_attempt 2 "$first. An earlier run on this issue was stopped by the watchdog ($first_reason) before it finished. The claim, if any, is yours: continue from the branch, the PR's Status line and the latest handoff instead of starting over."
  code=$?
  [ "$code" -eq 0 ] && exit 0
  second_reason=$(cat "$logs"/"$issue"-2-*.log.stopped 2>/dev/null | tail -n 1)
fi
if [ -n "$second_reason" ]; then
  stopped="The factory watchdog stopped it twice: ${first_reason:-unknown}; then $second_reason."
else
  stopped="The factory watchdog stopped it (${first_reason:-unknown}) with no time left in the run for a restart."
fi

# Gave up: leave the handoff the deliver skill would have left (delivery rule 2).
kind=$(gh issue view "$issue" --json labels -q '[.labels[].name | select(test("^(bug|feature|task):"))][0] // ""' 2>/dev/null | cut -d: -f1)
branch_line="no branch yet"
if [ "$mode" = deliver ] && [ -n "$kind" ]; then
  pr=$(gh pr list --head "$kind/$issue" --state open --json number,body -q '.[0] | "\(.number)"' 2>/dev/null)
  status=$(gh pr view "$kind/$issue" --json body -q .body 2>/dev/null | grep -E '^Implement:' | head -n 1)
  if git ls-remote --exit-code --heads origin "$kind/$issue" >/dev/null 2>&1; then
    branch_line="branch \`$kind/$issue\`${pr:+, PR #$pr}${status:+ — $status}"
  fi
elif [ "$mode" = triage ]; then
  git ls-remote --exit-code --heads origin "bug/$issue-repro" >/dev/null 2>&1 && branch_line="branch \`bug/$issue-repro\`"
fi
body=$(cat <<EOF
## Handoff

**Done:** what is on $branch_line; the PR's Status line, if any, says how far it got.

**Not done:** the $mode run did not finish. $stopped

**Findings:** the run records: \`.agents/scripts/memory.sh runs --issue $issue\`; the logs and transcripts are in the Factory workflow run's artifact, or under \`.worktrees/factory-runs/$issue-*\` on the machine that ran it.

**Blocked on:** maintainer: look at the logs, then restore the ready label to start a fresh run.

_Written by an agent._
EOF
)
if [ -n "$kind" ] && gh issue comment "$issue" --body "$body" >/dev/null 2>&1; then
  gh issue edit "$issue" --remove-assignee @me >/dev/null 2>&1 || true
  if [ "$mode" = deliver ]; then
    gh issue edit "$issue" --add-label "$kind:blocked" >/dev/null 2>&1 || true
  else
    gh issue edit "$issue" --add-label "bug:blocked" >/dev/null 2>&1 || true
  fi
  echo "factory-run: gave up on #$issue; handoff posted, claim released, moved to blocked" >&2
else
  echo "factory-run: gave up on #$issue and could not post the handoff (gh failed or the issue has no state label); logs in $logs" >&2
fi
exit 1
