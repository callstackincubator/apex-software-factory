# 0017 — The console chats with the intake and spec agents

Status: Proposed

Amends [0016](0016-a-local-factory-console.md).

## Context

The three people steps of the delivery flow (a visitor's idea, the product
owner's business sections, the developer's Technical spec) each happen in an
OpenCode conversation: `/intent` on the `intake` agent and `/spec` on the
`spec` agent. At the booth that means a terminal or OpenCode's own web app,
in a second window, with a typed command. The console already shows
everything after those steps. Business people at the booth should be able to
start their step from the same page, with the right skill already applied.

ADR 0016 §5 lets the console write in exactly three ways; a conversation is a
fourth.

## Decision

1. **The console may start and continue OpenCode sessions, for a fixed set
   of roles.** A role maps to one agent and one opening command:
   `intake` → agent `intake`, `/intent`; `spec` (business or technical, for
   an issue number) → agent `spec`, `/spec <n> [technical]`. The page names
   a role and an issue number, never an agent or a command. The `build` and
   `factory` agents, and every subagent, are out of reach.
2. **Through the person's own OpenCode service, with the CLI.** The console
   runs `opencode api …`, which reaches the background service the person's
   `opencode` CLI uses and supplies the credentials itself. The console still
   never holds OpenCode's password or a session token, and every session it
   starts can be opened from the CLI when something breaks.
3. **Only its own sessions.** The console continues, answers forms in, and
   stops only sessions this console process started.
4. **What the agents may do stays in their own files.** `intake` talks and
   files one issue; `spec` writes issue bodies and, at most, a Proposed ADR,
   starts only `spec-checker`, and cannot set a ready label. The console adds
   no permission of its own.
5. ADR 0016 §5 gains a fourth write: **Chat** starts sessions on the agents
   in (1) and sends the person's messages and form answers to them.

## Consequences

- A visitor, a product owner and a developer each work from a console tab,
  and the issue they produce appears in the same console.
- Visitor text reaches an agent from a page as well as from a terminal; the
  agents' rules already treat it as content, never instructions, and the
  `intake` agent still files only after the visitor's yes.
- A console restart forgets which sessions it started; the sessions stay in
  OpenCode and can be resumed from the CLI.
- The chat polls; OpenCode's event stream is not used, since `opencode api`
  does not relay it.
