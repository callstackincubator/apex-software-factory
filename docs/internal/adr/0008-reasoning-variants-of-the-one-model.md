# 0008 — Each agent picks a reasoning variant of the one model

Status: Accepted

Amends [0004](0004-opencode-with-one-model.md).

## Context

A clean delivery took about 29 minutes, most of it in stages that read report
blocks or reproduce a cited line rather than reason about code. Every agent
ran the one model at its default reasoning effort. `callstack.ai/callstack/Apex`
offers reasoning variants (`none`, `low`, `medium`, `xhigh`) of the same
model, and OpenCode lets an agent choose one (`variant` in its config).

OpenCode applies an agent's `variant` only together with the agent's own
`model` (schema: "applies only when using the agent's configured model"). An
agent that inherits the top-level model gets no variant: verified with
`opencode debug agents`, which resolved `variant` only for agents that also set
`model`.

## Decision

- A variant is the same model with a different reasoning effort, not another
  model. ADR 0004's "one model" stands.
- Each factory agent sets `model: callstack.ai/callstack/Apex` and a `variant`
  in its file in `.opencode/agent/`:
  - `low`: `factory` (reasons over report blocks), `review-verifier`
    (reproduces cited evidence), `ota-verifier` (follows a fixed device
    script);
  - `medium`: `implementer`, `code-reviewer`, `spec-reviewer`,
    `mobile-verifier`, `triager`, `spec-checker`.
- `intake` and the `build` agent keep the top-level default. The model id in
  an agent file must equal `opencode.json`'s `model`; switching the model
  changes those lines too.
- The choice was made without measurements, on the maintainer's instruction.
  A stage whose quality drops gets `medium` back; nothing else depends on it.

## Consequences

Switching the model is no longer a one-line change: it is `opencode.json` plus
the `model:` line of each agent file (one search and replace). Reviews still
cannot lean on a different model's blind spots, so the blind-input discipline
of ADR 0004 is unchanged.
