#!/usr/bin/env bash
# After a deploy, asks every booth phone paired with this laptop's appduct daemon to check for
# the update now (appduct tool `ota_check_now`), instead of waiting for its 30 s poll.
#
#   scripts/ci/ota-nudge.sh            from the repo root, after a successful deploy
#
# Best effort by design: no daemon, no paired phone, a phone that went away, a tool that times
# out — each is one line in the log and exit 0. It never starts the daemon (a daemon this job
# started would have no phones) and never fails the job. Pairing a phone and keeping it paired:
# docs/internal/OTA.md, "Booth phones: appduct pairing".
set -uo pipefail

mobile=apps/mobile
summary() { [ -n "${GITHUB_STEP_SUMMARY:-}" ] && printf '%s\n' "$@" >>"$GITHUB_STEP_SUMMARY"; return 0; }

sock=${APPDUCT_STATE_DIR:-$HOME/.appduct}/daemon.sock
if [ ! -S "$sock" ]; then
  echo "ota-nudge: no appduct daemon on this machine; phones pick the update up on their own poll"
  exit 0
fi

# macOS has no timeout(1); perl's alarm survives exec and ends a call that hangs.
ad() { (cd "$mobile" && perl -e 'alarm shift; exec @ARGV' "${OTA_NUDGE_TIMEOUT:-20}" pnpm exec appduct "$@" 2>&1); }

list=$(ad sessions ls --json) || {
  echo "ota-nudge: could not list appduct sessions: $(printf '%s' "$list" | tail -n 1)"
  exit 0
}
ids=$(printf '%s' "$list" | node -e '
  let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
    let data; try { data = JSON.parse(s).data ?? []; } catch { return; }
    for (const x of Array.isArray(data) ? data : []) {
      const id = x.sessionId ?? x.id;
      if (id && (x.state ?? "active") === "active") console.log(`${id} ${x.alias ?? ""}`);
    }
  });')
if [ -z "$ids" ]; then
  echo "ota-nudge: no paired phone (appduct sessions ls is empty); phones pick the update up on their own poll"
  summary "- Booth phones: none paired with appduct; they check every 30 s."
  exit 0
fi

nudged=0
while read -r id alias; do
  [ -n "$id" ] || continue
  if out=$(ad tools call "$id" ota_check_now --input '{}' --json); then
    status=$(printf '%s' "$out" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);const r=j.data?.result??j.data??{};console.log(r.status??r.result??JSON.stringify(r).slice(0,80))}catch{console.log("answered")}})')
    echo "ota-nudge: ${alias:-$id}: $status"
    nudged=$((nudged + 1))
  else
    echo "ota-nudge: ${alias:-$id}: no answer ($(printf '%s' "$out" | tail -n 1))"
  fi
done <<<"$ids"
summary "- Booth phones nudged with \`ota_check_now\`: $nudged"
exit 0
