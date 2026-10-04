# 0004 — The factory runs on OpenCode with one model

Status: Accepted (amended by [0008](0008-reasoning-variants-of-the-one-model.md))

## Context

The agentic setup was inherited from a Claude Code–first project that pinned
different models per stage (a stronger reviewer, a cheaper implementer). Here
every stage runs in OpenCode, and exactly one model is available:
`callstack.ai/callstack/Apex`.

## Decision

- `opencode.json` sets `model` (and `small_model`) once. No agent, command or
  skill names another model. An agent may name the same model to pick a
  reasoning variant: a variant is the same model with a different reasoning
  effort, not a second model (ADR 0008). Every other agent inherits it.
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

Switching the model is a one-line change in `opencode.json` plus the same
search-and-replace in the agent files that pick a variant (ADR 0008). Reviews cannot lean on a different
model's blind spots, so the blind-input discipline in the review skill is
load-bearing.
