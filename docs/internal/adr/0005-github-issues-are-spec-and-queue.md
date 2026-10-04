# 0005 — GitHub Issues are the spec and the queue

Status: Accepted

## Context

Product people (booth visitors, via a facilitator) describe intent; a developer
turns it into a technical spec; agents deliver unattended. Each handoff needs
a durable artifact the next stage reads, mapped to the AI-native SDLC
playbook's intent → spec → plan → PR chain.

## Decision

GitHub Issues in `callstackincubator/apex-software-factory` hold every spec;
one `<kind>:<state>` label is the only signal an agent may act on. The mapping:

| Playbook artifact | Here |
| --- | --- |
| `intent.md` | a `request:new` issue from the feature form or `/intent` |
| `spec.md` (product) | business sections of a `feature:spec` issue |
| tech spec / `plan.md` | Decisions + Technical spec, or `task:*` sub-issues; the developer sets `feature:ready` |
| PR + review | a `<kind>/<n>` branch PR with a `## Review` section |
| deploy record | the merge commit and its `ota-publish` run |

The full rules live in `docs/internal/agent-rules/delivery.md`.

## Consequences

The repository and its issue history are the audit trail. Everything an
agent may do is decided by a label a human or configured automation set.
