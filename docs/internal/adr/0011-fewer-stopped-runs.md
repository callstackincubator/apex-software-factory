# 0011 — Fewer stopped runs: a spec check before ready, house defaults, assumptions instead of parking

Status: Accepted

Amends delivery rules 3 and 7.

## Context

One booth task needed six factory runs. Several stopped on spec gaps nobody
had noticed when the developer set the ready label (a failure mode with no
answer, a Done when line no device check could read), and on questions every
booth feature shares (what does the screen show while loading, on an error,
when empty, offline?). Each stop meant a handoff, a person reading it, a spec
edit, a relabel and a new run. The rules made "the spec is the body" so
strict that the implementer parked on any question the body left open.

## Decision

1. **Spec check before ready.** `spec-session technical` ends by starting a
   fresh `spec-checker` subagent (read-only, `medium` variant). It reads the
   body as posted, the agent rules, the ADRs,
   `docs/internal/NATIVE-CAPABILITIES.md` and the code, and reports
   contradictions with a rule or ADR, untestable Done when or completion
   lines, failure modes nothing answers, native capabilities the installed
   binary lacks ("needs native build"), and selectors missing from Agent
   hooks. The developer resolves the findings before setting the ready label.
2. **House defaults.** `docs/internal/agent-rules/defaults.md` answers what a
   spec leaves unsaid: loading skeletons, inline errors with retry and a 5 s
   timeout, empty states, offline behaviour, `testID`s and labels, copy tone,
   an appduct tool, a deep link and an `.ad` script per new screen, a
   shipped-features entry, wire bounds (16 KiB bodies, 280-character fields,
   100 items, 64-character ids), no visitor data, no native change. A spec
   that wants something else says so, and the spec wins. The spec reviewer
   receives `defaults.md` with every spec. `docs/internal/templates/booth-feature.md`
   is a one-PR feature body pre-filled with these, so the developer writes
   only what is specific.
3. **Assumptions instead of parking.** A small gap the body, the rules and the
   defaults all leave open is closed by the implementer the conservative way
   and recorded as an `Assumption:` line in the PR body's `## Assumptions`
   section. The spec reviewer gets those lines (and nothing else from the PR
   body) and checks each is conservative and consistent with the spec. An
   assumption is a visible proposal, not a spec change: the body stays the
   spec (rule 3). The factory parks only for a contradiction with the body, a
   rule or an accepted ADR, or a user-visible product decision nobody made —
   not for a wording, an order or a bound the spec implies.
4. Spec-session and implement consult `docs/internal/NATIVE-CAPABILITIES.md`
   (maintained with the native binary); a capability it does not list needs a
   native build.

## Consequences

- The developer's session gets one more step, minutes long, in exchange for
  fewer parked runs.
- The implementer now makes small product choices. They are listed in the PR
  for the reviewer and the maintainer, and the defaults keep them uniform;
  one a person dislikes is a follow-up issue, not a stopped delivery.
- The spec reviewer is no longer blind to every rule: `defaults.md` is part
  of every spec. It still never sees the other rules, the rest of the PR body
  or commit messages.
- Delivery rules 3, 7 and 14, the `spec-session`, `implement`, `review` and
  `deliver` skills, the `spec-reviewer`, `review-verifier` and `spec-checker`
  agents, `review-inputs.sh`, the PR template and the new template follow from
  this record.
