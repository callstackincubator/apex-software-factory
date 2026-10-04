# 0015 — Hard step caps per agent; the implementer never leases a device; the dispatcher runs the newest main

Status: Accepted

Amends [0007](0007-device-lane-simlock-agent-device.md) (decision 7) and
[0009](0009-a-faster-delivery-loop.md) (decision 5).

## Context

The second timed run of #18 (4 Oct 2026) took 80 minutes before the watchdog
stopped it: implement 27.9 min over 78 steps, of which about 5 were its own
simulator check (including minutes reading agent-device and React Native
sources); code review 28.3 min over 76 steps; review verifier 10.1 min. Most
of that time was the model re-planning from scratch every step, because the
provider dropped the reasoning carried between steps (fixed by ADR 0014).
Rules in a prompt did not stop either stage: nothing bounded how many steps a
subagent could take. The first code review returned garbled text and was
retried, as the skills say. And a queued or re-run dispatcher run delivers
with the factory code of the commit that triggered it, not today's.

## Decision

1. **Every factory agent has a hard step cap** (`steps:` in its file in
   `.opencode/agent/`, OpenCode's maximum agentic iterations before it forces
   a text-only answer), from the steps the timed runs used: `factory` 60,
   `implementer` 80, `code-reviewer` 40, `spec-reviewer` 20,
   `review-verifier` 30, `mobile-verifier` 40, `ota-verifier` 40, `triager`
   60, `spec-checker` 25. At the cap the agent must report with what it has.
2. **The implementer never leases a device.** Its job ends at `pnpm check`,
   the native check and its report; the `mobile-verifier` (3.4 minutes in the
   second run) checks the screen in parallel with the code review.
3. **A report without its block is a failure.** A reviewer or a stage that
   returns narration, garbled text or nothing is run once more; a second
   failure parks the issue with that reason, and is never read as
   "No findings.".
4. **The dispatcher runs the newest main.** `factory.yml` fetches `main` and
   checks out its tip after the checkout, whatever commit the event carried,
   and writes the commit into the job summary.

## Consequences

- A stage that hits its cap reports less than it might have; the caps sit
  above what the runs needed, so hitting one means a stage went astray.
- No device contention from implementers; one lease per PR, by the verifier.
- Delivery rule 16, the `implement`, `review` and `deliver` skills, the agent
  files and `factory.yml` follow from this record.
