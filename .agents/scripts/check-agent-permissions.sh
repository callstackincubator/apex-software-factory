#!/usr/bin/env sh
# Fails if any of the repo's subagents can resolve a tool call to "ask".
#
#   .agents/scripts/check-agent-permissions.sh        run from the checkout, with opencode on PATH
#
# `opencode run --auto` approves the primary agent's asks only; a subagent that reaches "ask"
# waits forever (OpenCode 2.0.11), so an unattended factory run hangs. Every subagent's rules
# must end in allow or deny for every action. This reads the permissions OpenCode resolves
# (`opencode debug agents`: built-in defaults, then opencode.json, then the agent's own file)
# and, for each subagent defined in .opencode/agent/ and each action, finds the last catch-all
# rule (resource "*"); the action can reach "ask" when there is none, when it says ask, or when
# a later, narrower rule says ask. A subagent's `question` tool must be denied outright, since
# it too waits for a person. Primary agents are listed for information only: --auto answers
# their asks. MCP tools are checked under their server prefixes.
#
# Run it after changing permissions in opencode.json or .opencode/agent/*.md. It needs the
# opencode CLI and the model provider config, so CI cannot run it; it is a local check.
# Exits 0 when no subagent can reach "ask", 1 when one can, 69 without opencode.
set -eu

command -v opencode >/dev/null 2>&1 || {
  echo "unavailable: opencode not on PATH" >&2
  exit 69
}
root=$(git rev-parse --show-toplevel)
cd "$root"
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
# The background server caches agent files until told to reload; without this the check can
# read the permissions from before your edit.
opencode reload >/dev/null
# Right after a reload the server can answer with the built-in agents only: wait until every
# agent file shows up. Redirect to a file: piped, opencode 2.0.11 cuts its output at 512 KiB.
tries=0
while :; do
  opencode debug agents >"$tmp"
  missing=$(node -e '
    const ids = new Set(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).map((a) => a.id));
    const want = require("fs").readdirSync(process.argv[2]).filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3));
    console.log(want.filter((w) => !ids.has(w)).join(" "));
  ' "$tmp" "$root/.opencode/agent" 2>/dev/null || echo unreadable)
  [ -n "$missing" ] || break
  tries=$((tries + 1))
  [ "$tries" -lt 15 ] || {
    echo "opencode does not list these agents: $missing" >&2
    exit 1
  }
  sleep 2
done

node - "$tmp" "$root/.opencode/agent" <<'EOF'
const fs = require("fs");
const path = require("path");
const [file, dir] = process.argv.slice(2);
const agents = JSON.parse(fs.readFileSync(file, "utf8"));
const ours = new Set(fs.readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3)));

// Every permission OpenCode 2.0.11 asks about, plus the MCP servers in opencode.json.
const mcp = Object.keys(JSON.parse(fs.readFileSync("opencode.json", "utf8")).mcp ?? {});
const actions = [
  "shell", "edit", "read", "glob", "grep", "list", "webfetch", "websearch", "external_directory",
  "doom_loop", "subagent", "skill", "question", "lsp", "todowrite", "todoread", "execute",
  ...mcp.map((s) => `${s}_tool`),
];

const glob = (value, pattern) =>
  new RegExp("^" + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$", "s").test(value);

// The resources for which `action` can resolve to "ask", or [] when none can.
const asks = (rules, action) => {
  const mine = rules.filter((r) => glob(action, r.action));
  let last = -1;
  mine.forEach((r, i) => { if (r.resource === "*") last = i; });
  if (last === -1) return ["(no catch-all rule)"];
  return mine.slice(last).filter((r) => r.effect === "ask").map((r) => r.resource);
};

// The question tool waits for a person's answer, which never comes to a subagent: it must
// resolve to deny there, not just avoid "ask".
const effect = (rules, action) =>
  rules.filter((r) => glob(action, r.action) && r.resource === "*").at(-1)?.effect ?? "ask";

let failed = 0;
for (const agent of agents) {
  if (!ours.has(agent.id)) continue;
  const subagent = agent.mode !== "primary";
  if (subagent && effect(agent.permissions, "question") !== "deny") {
    failed++;
    console.log(`FAIL ${agent.id} (${agent.mode}): question is not denied (it would wait for a person)`);
  }
  for (const action of actions) {
    const found = asks(agent.permissions, action);
    if (!found.length) continue;
    const name = action.endsWith("_tool") ? `${action.slice(0, -5)}_*` : action;
    if (subagent) {
      failed++;
      console.log(`FAIL ${agent.id} (${agent.mode}): ${name} can ask for ${found.join(", ")}`);
    } else {
      console.log(`info ${agent.id} (primary): ${name} asks for ${found.join(", ")} (--auto answers it)`);
    }
  }
}
const checked = agents.filter((a) => ours.has(a.id) && a.mode !== "primary").map((a) => a.id);
console.log(`${checked.length} subagents checked (${checked.join(", ")}): ${failed ? `${failed} can ask` : "none can ask"}`);
process.exit(failed ? 1 : 0);
EOF
