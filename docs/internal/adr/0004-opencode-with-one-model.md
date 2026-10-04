# 0004 — The factory runs on OpenCode with one model

Status: Accepted

## Context

The agentic setup was inherited from a Claude Code–first project that pinned
different models per stage (a stronger reviewer, a cheaper implementer). Here
every stage runs in OpenCode, and exactly one model is available:
`callstack.ai/callstack/Apex`.

## Decision

- `opencode.json` sets `model` (and `small_model`) once. No agent, command or
  skill names a model; every subagent inherits it.
- Skills live in `.agents/skills/<name>/SKILL.md` with only `name` and
  `description` in the frontmatter. Stages that must run in a fresh context
  are OpenCode subagents in `.opencode/agent/` (`mode: subagent`), each
  loading its skill and returning a fixed report block.
- Review independence comes from context isolation alone: reviewers are fresh
  subagents that read only the inputs directory prepared for them, never the
  implementer's session, PR body or commit messages.
- Hard rules are enforced outside the agent where possible (lefthook, CI,
  `issue-state.yml`, `merge-pr.sh`); `opencode.json` permissions back them up.
- No file in the repo depends on Claude Code (`CLAUDE.md`, `.claude/`,
  Claude-specific tool names). `AGENTS.md` is the single entry point.

## Consequences

Switching the model is a one-line change. Reviews cannot lean on a different
model's blind spots, so the blind-input discipline in the review skill is
load-bearing.
