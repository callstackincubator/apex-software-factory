# 0014 — Keep the model's reasoning between steps

Status: Accepted

## Context

A factory run on issue #18 took 28 minutes in the implementer and 28 more in
one code review. Tools and builds were a small part of that. The model spent
24 of the implementer's 28 minutes thinking: about 200k reasoning tokens over
78 steps, often 10–16k before a single `sed`. The prompt grew by only about
500 tokens per step, so none of that thinking reached the next step. The
model designed the same change three times in a row, and the code reviewer
kept "circling" the same question.

OpenCode sends earlier reasoning back on each assistant message as
`reasoning_content`. The Callstack endpoint (vLLM) ignores that field when it
renders the chat; it reads the newer name, `reasoning`. Measured with 1-token
probes on the same request with about 3,600 tokens of padding as reasoning:
`reasoning_content` added 0 prompt tokens (with or without
`clear_thinking`/`preserve_thinking` template flags); `reasoning` added
3,601.

## Decision

`opencode.json` carries the whole Callstack provider definition (base URL,
limits, the reasoning variants), so a machine needs only `opencode auth login`
for `callstack.ai` and no global provider config. On top of Callstack's
standard definition it sets one field, so OpenCode sends earlier reasoning as
`reasoning`:

```json
"compatibility": { "reasoningField": "reasoning" }
```

It changes how history is sent, not the model or its reasoning variant
(ADR 0004, ADR 0008). A global config on the machine with the same provider
still works; the repo's settings merge over it.

## Consequences

- Each step sees the reasoning of the steps before it, so the model does not
  re-plan from nothing.
- The context grows faster. OpenCode compacts long sessions; a step that used
  to re-derive a plan should now need much less new reasoning.
- If the endpoint moves back to `reasoning_content`, or OpenCode changes the
  key, re-run the probe in docs/BOOTSTRAP.md ("Check the model keeps its
  reasoning") and update this setting.
