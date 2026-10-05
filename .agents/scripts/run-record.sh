#!/usr/bin/env bash
# Writes the record of one factory run attempt (ADR 0016), so the retro can study the run on any
# machine, without this machine's OpenCode database.
#
#   .agents/scripts/run-record.sh <issue> <mode> <attempt> <agent> <since-ms> <log> [<stopped reason>]
#
# factory-run.sh calls it after every attempt. From the sessions the attempt started (the top
# <agent> session created since <since-ms> in this checkout, and every subagent session under
# it) in ~/.local/share/opencode/opencode.db (OPENCODE_DB), it writes next to <log>:
#   <log>.digest.md             per stage: time, steps against the cap, finish reasons, tokens,
#                               tool calls, repeated calls, tool errors, the task prompt and the
#                               report block; the attempt's journal (<log>.journal.md); the log tail
#   <log>.transcript.jsonl.gz   every message of those sessions, one JSON object per line
# Both are redacted: anything shaped like a token or key becomes [redacted]. The digest is
# pushed to the memory branch as runs/<YYYY-MM>/<start>-<mode>-<issue>-a<attempt>.md; under the
# dispatcher, factory.yml uploads the whole factory-runs directory as the run's artifact.
#
# Reads the database read-only. The tool-call sections read fields OpenCode does not document
# and stay empty when they are not there; the rest uses what factory-run.sh already relies on.
# Never fails a run: a part it cannot write is left out. Exit 0, or 64 on usage.
set -uo pipefail

[ $# -ge 6 ] || {
  sed -n '2,20p' "$0" >&2
  exit 64
}
issue=$1 mode=$2 attempt=$3 agent=$4 since=$5 log=$6 stopped=${7:-}
case $issue$attempt$since in *[!0-9]*) exit 64 ;; esac
case $agent in '' | *[!a-z-]*) exit 64 ;; esac

root=$(git rev-parse --show-toplevel)
scripts=$(cd "$(dirname "$0")" && pwd)
db=${OPENCODE_DB:-$HOME/.local/share/opencode/opencode.db}
digest=$log.digest.md
transcript=$log.transcript.jsonl.gz
journal=$log.journal.md
tab=$(printf '\t')

redact() {
  sed -E \
    -e 's/gh[opusr]_[A-Za-z0-9]{20,}/[redacted]/g' \
    -e 's/github_pat_[A-Za-z0-9_]{20,}/[redacted]/g' \
    -e 's/sk-[A-Za-z0-9_-]{20,}/[redacted]/g' \
    -e 's/AKIA[0-9A-Z]{16}/[redacted]/g' \
    -e 's/xox[abposr]-[A-Za-z0-9-]{10,}/[redacted]/g' \
    -e 's/((Bearer|bearer|[Tt]oken|TOKEN|[Ss]ecret|SECRET|[Pp]assword|PASSWORD|[Aa]pi[_-]?[Kk]ey|API[_-]?KEY)[\\"'"'"' :=]+)[A-Za-z0-9._\/+=-]{16,}/\1[redacted]/g'
}

# Seconds since the epoch as UTC text; BSD date first (the booth Macs), then GNU.
utc() { date -u -r "$1" "+$2" 2>/dev/null || date -u -d "@$1" "+$2"; }
mmss() {
  local s=$(($1 / 1000))
  printf '%d:%02d' $((s / 60)) $((s % 60))
}

have_db=
if command -v sqlite3 >/dev/null 2>&1 && [ -r "$db" ]; then
  top=$(sqlite3 -readonly "$db" "
    select id from session_v2 where parent_id is null and agent = '$agent'
      and time_created >= $since and (directory = '$root' or directory like '$root/%')
      order by time_created desc limit 1;" 2>/dev/null || true)
  [ -n "$top" ] && have_db=1
fi

# sql: run stdin against the database, with @TREE@ (the attempt's session tree) and @SID@ ($1)
# filled in. Tab-separated, no header.
sql() {
  sed -e "s|@TREE@|with recursive tree(id) as (select '$top' union select s.id from session_v2 s join tree t on s.parent_id = t.id)|" \
    -e "s|@SID@|${1:-}|g" |
    sqlite3 -readonly -separator "$tab" "$db" 2>/dev/null
}

step_cap() { sed -n '/^---$/,/^---$/s/^steps: *//p' "$root/.opencode/agent/$1.md" 2>/dev/null | head -n 1; }

# The queries, one function each: bash 3.2 misreads a heredoc inside $( ).
q_calls() {
  sql <<'SQL'
@TREE@
select s.agent, x.name, count(*) from (
  select m.session_id as sid,
    case when c.type = 'object' then coalesce(json_extract(c.value, '$.tool'), json_extract(c.value, '$.name'), json_extract(c.value, '$.toolName')) end as name
  from session_message m join tree t on t.id = m.session_id, json_each(m.data, '$.content') c
  where m.type = 'assistant'
    and (case when c.type = 'object' then json_extract(c.value, '$.type') end) not in ('text', 'reasoning')
) x join session_v2 s on s.id = x.sid
where x.name is not null
group by x.sid, x.name order by s.time_created, count(*) desc;
SQL
}

q_repeated() {
  sql <<'SQL'
@TREE@
select s.agent, x.name, count(*), substr(replace(replace(replace(x.input, char(10), ' '), char(9), ' '), '`', ''''), 1, 160) from (
  select m.session_id as sid,
    case when c.type = 'object' then coalesce(json_extract(c.value, '$.tool'), json_extract(c.value, '$.name'), json_extract(c.value, '$.toolName')) end as name,
    case when c.type = 'object' then coalesce(json_extract(c.value, '$.input'), json_extract(c.value, '$.state.input'), json_extract(c.value, '$.args'), json_extract(c.value, '$.arguments')) end as input
  from session_message m join tree t on t.id = m.session_id, json_each(m.data, '$.content') c
  where m.type = 'assistant'
) x join session_v2 s on s.id = x.sid
where x.name is not null and x.input is not null
group by x.sid, x.name, x.input having count(*) >= 3 order by count(*) desc limit 15;
SQL
}

q_errors() {
  sql <<'SQL'
@TREE@
select s.agent, x.name, substr(replace(replace(x.err, char(10), ' '), char(9), ' '), 1, 200) from (
  select m.session_id as sid, m.seq as seq,
    case when c.type = 'object' then coalesce(json_extract(c.value, '$.tool'), json_extract(c.value, '$.name')) end as name,
    case when c.type = 'object' and (coalesce(json_extract(c.value, '$.state.status'), json_extract(c.value, '$.status')) = 'error'
                                     or json_extract(c.value, '$.error') is not null)
      then coalesce(json_extract(c.value, '$.state.error'), json_extract(c.value, '$.error'), 'error') end as err
  from session_message m join tree t on t.id = m.session_id, json_each(m.data, '$.content') c
) x join session_v2 s on s.id = x.sid
where x.err is not null order by s.time_created, x.seq limit 25;
SQL
}

# At most $1 lines and $2 characters.
clip() { head -n "$1" | cut -c "1-$2"; }

write_digest() {
  local start_s=$((since / 1000)) code
  code=${FACTORY_CODE:-$(git rev-parse --short HEAD 2>/dev/null)}
  echo "# Run: $mode #$issue, attempt $attempt"
  echo
  echo "- Started: $(utc "$start_s" '%Y-%m-%d %H:%M:%S') UTC"
  if [ -n "$stopped" ]; then
    echo "- Ended: stopped by the watchdog: $stopped"
  else
    echo "- Ended: on its own (the issue and the PR say how)"
  fi
  echo "- Factory code: main at $code; model ${FACTORY_MODEL:-unknown}"
  if [ -n "${GITHUB_RUN_ID:-}" ]; then
    echo "- Dispatcher run: ${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY:-}/actions/runs/$GITHUB_RUN_ID (attempt ${GITHUB_RUN_ATTEMPT:-1}); its artifact \`factory-run-$issue-$GITHUB_RUN_ID-${GITHUB_RUN_ATTEMPT:-1}\` holds the log${have_db:+ and \`$(basename "$transcript")\`}"
  else
    echo "- Started by hand on $(hostname -s 2>/dev/null || echo "this machine"); log \`$log\` there"
  fi
  echo

  if [ -n "$have_db" ]; then
    echo "## Stages"
    echo
    echo "Start is minutes after the attempt started; steps are the session's model turns, against its cap."
    echo
    echo "| Agent | Start | Time | Steps | Finish | Outcome | Output tok | Reasoning tok | Peak prompt tok | Task |"
    echo "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |"
    sql <<'SQL' | while IFS=$tab read -r id ag created updated title steps finish outcome out reas peak; do
@TREE@
select s.id, coalesce(s.agent, '?'), s.time_created, s.time_updated,
  substr(replace(replace(replace(coalesce(s.title, ''), char(9), ' '), char(10), ' '), '|', '/'), 1, 60),
  (select count(*) from session_message m where m.session_id = s.id and m.type = 'assistant'),
  coalesce((select group_concat(f || ' ' || n, ', ') from (
    select coalesce(json_extract(m.data, '$.finish'), '?') as f, count(*) as n from session_message m
      where m.session_id = s.id and m.type = 'assistant' group by f order by n desc)), ''),
  coalesce((select json_extract(m.data, '$.outcome') from session_message m
    where m.session_id = s.id and m.type = 'idle' order by m.seq desc limit 1), ''),
  coalesce((select sum(json_extract(m.data, '$.tokens.output')) from session_message m
    where m.session_id = s.id and m.type = 'assistant'), 0),
  coalesce((select sum(json_extract(m.data, '$.tokens.reasoning')) from session_message m
    where m.session_id = s.id and m.type = 'assistant'), 0),
  coalesce((select max(coalesce(json_extract(m.data, '$.tokens.input'), 0) + coalesce(json_extract(m.data, '$.tokens.cache.read'), 0))
    from session_message m where m.session_id = s.id and m.type = 'assistant'), 0)
from session_v2 s join tree t on t.id = s.id order by s.time_created;
SQL
      cap=$(step_cap "$ag")
      echo "| $ag | +$(mmss $((created - since))) | $(mmss $((updated - created))) | $steps${cap:+/$cap} | $finish | $outcome | $out | $reas | $peak | $title |"
    done
    echo

    local calls
    calls=$(q_calls)
    echo "## Tool calls"
    echo
    if [ -n "$calls" ]; then
      printf '%s\n' "$calls" | awk -F '\t' '
        $1 != last { if (line != "") print line; line = "- " $1 ":"; sep = " "; last = $1 }
        { line = line sep $2 " " $3; sep = ", " }
        END { if (line != "") print line }'
    else
      echo "Not recorded in a form this script reads. Message types per stage:"
      echo
      sql <<'SQL' | awk -F '\t' '
        $1 != last { if (line != "") print line; line = "- " $1 ":"; sep = " "; last = $1 }
        { line = line sep $2 " " $3; sep = ", " }
        END { if (line != "") print line }'
@TREE@
select s.agent, m.type, count(*) from session_message m join tree t on t.id = m.session_id
  join session_v2 s on s.id = m.session_id
group by m.session_id, m.type order by s.time_created, count(*) desc;
SQL
    fi
    echo

    local repeated
    repeated=$(q_repeated)
    if [ -n "$repeated" ]; then
      echo "## Repeated calls (the same call three times or more)"
      echo
      printf '%s\n' "$repeated" | awk -F '\t' '{ printf "- %s: %s x%s `%s`\n", $1, $2, $3, $4 }'
      echo
    fi

    local errors
    errors=$(q_errors)
    if [ -n "$errors" ]; then
      echo "## Tool errors (first 25)"
      echo
      printf '%s\n' "$errors" | awk -F '\t' '{ printf "- %s: %s: %s\n", $1, $2, $3 }'
      echo
    fi

    echo "## Prompts and reports"
    echo
    echo "Each stage's task prompt and its last text (the report block, when it gave one)."
    sql <<'SQL' | while IFS=$tab read -r id ag; do
@TREE@
select s.id, coalesce(s.agent, '?') from session_v2 s join tree t on t.id = s.id order by s.time_created;
SQL
      echo
      echo "### $ag ($id)"
      echo
      if [ "$id" != "$top" ]; then
        echo "Task prompt:"
        echo
        echo '````text'
        sql "$id" <<'SQL' | clip 25 400
select coalesce(
  case when json_type(d, '$.content') = 'text' then json_extract(d, '$.content') end,
  (select group_concat(json_extract(c.value, '$.text'), char(10)) from json_each(d, '$.content') c
    where (case when c.type = 'object' then json_extract(c.value, '$.type') end) = 'text'),
  json_extract(d, '$.text'), '')
from (select m.data as d from session_message m where m.session_id = '@SID@' and m.type = 'user' order by m.seq limit 1);
SQL
        echo '````'
        echo
      fi
      echo "Last text:"
      echo
      echo '````text'
      sql "$id" <<'SQL' | clip 60 400
select group_concat(json_extract(c.value, '$.text'), char(10)) from json_each((
  select m.data from session_message m where m.session_id = '@SID@' and m.type = 'assistant'
    and exists (select 1 from json_each(m.data, '$.content') c2
      where (case when c2.type = 'object' then json_extract(c2.value, '$.type') end) = 'text'
        and trim(coalesce(json_extract(c2.value, '$.text'), '')) <> '')
  order by m.seq desc limit 1), '$.content') c
where (case when c.type = 'object' then json_extract(c.value, '$.type') end) = 'text';
SQL
      echo '````'
    done
    echo
  else
    echo "## Stages"
    echo
    echo "No session found in OpenCode's database ($db) for this attempt."
    echo
  fi

  echo "## Journal"
  echo
  if [ -s "$journal" ]; then
    cat "$journal"
  else
    echo "No journal lines."
  fi
  echo
  echo "## Log tail"
  echo
  echo '````text'
  [ -f "$log" ] && tail -n 20 "$log" | cut -c 1-300
  echo '````'
}

write_digest | redact >"$digest" 2>/dev/null || true

if [ -n "$have_db" ]; then
  sql <<'SQL' | redact | gzip -c >"$transcript" 2>/dev/null || rm -f "$transcript"
@TREE@
select json_object('session', m.session_id, 'agent', s.agent, 'parent', s.parent_id, 'seq', m.seq,
  'type', m.type, 'time', m.time_created,
  'data', case when json_valid(m.data) then json(m.data) else m.data end)
from session_message m join tree t on t.id = m.session_id join session_v2 s on s.id = m.session_id
order by s.time_created, m.seq;
SQL
fi

dest=runs/$(utc $((since / 1000)) '%Y-%m')/$(utc $((since / 1000)) '%Y%m%d-%H%M%S')-$mode-$issue-a$attempt.md
if [ -s "$digest" ] && "$scripts/memory.sh" put "$dest" "$digest" -m "run record: $mode #$issue attempt $attempt" >/dev/null; then
  echo "run-record: $dest on the memory branch; $digest"
else
  echo "run-record: $digest (not pushed to the memory branch)"
fi
exit 0
