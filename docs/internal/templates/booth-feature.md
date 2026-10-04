<!--
Booth feature. A one-PR feature for the booth app, business and technical
spec in one body, pre-filled with the house defaults
(docs/internal/agent-rules/defaults.md) so the developer writes only what is
specific to this idea. Replace every <...>; delete a "Specific:" line that
has nothing to add. A spec session writes it; `/spec <n> technical` ends with
the spec checker, and the developer sets feature:ready once it says ready.
A feature that needs more than one PR uses templates/feature.md instead.
-->

Request: #NNN <!-- the request:new issue this came from, or "none" -->

## Problem

<!-- One or two sentences, in the visitor's terms. -->

## Who it is for

<!-- Default: a visitor at the Callstack booth, holding the booth phone. -->

A visitor at the Callstack booth, holding the booth phone.

## Outcome

<!-- What they can see and tap after this lands. -->

## Non-goals

- No accounts, tracking or stored personal data (defaults 10).
- No native change: only what the installed binary has (defaults 11).
- <anything else this deliberately does not do>

## Completion conditions

<!-- How anyone checks it on a phone running the update. -->

- On the simulator: <`testID`> reads <text>.
- <...>

## Open questions

<!-- Empty before feature:ready. -->

## Decisions

- none

## Technical spec

### Packages and modules touched

- `apps/mobile`: <files>
- <`packages/contract`, `apps/api` when it crosses the wire, contract first>

### Contract changes

none <!-- or every schema and field, with its bound (defaults 9) -->

### Native change

none — JS only, ships over the air. <!-- checked against docs/internal/NATIVE-CAPABILITIES.md -->

### Rules in play

- defaults.md — loading, errors, empty, offline, labels, copy, limits.
- testing.md — tests as claims, each able to fail.
- <architecture.md when it crosses the wire; safety.md when it takes input>

### Failure modes and limits

Defaults 1–4 and 9 apply: skeleton while loading, inline error with "Try
again" and a 5 s timeout, a one-sentence empty state, nothing breaks
offline, wire input bounded (16 KiB body, 280-character fields, 100 items).

- Specific: <only where this feature differs, with numbers>

### Agent hooks

Defaults 5 and 7 apply: every element named below has this `testID` and
label; a new screen has a deep link and an appduct tool.

- `testID` `<id>`, label "<label>" — <what it shows>
- Deep link: <`apexfactory:///<route>`, or "none (no new screen)">
- appduct tool: <name, input, output, read-only | destructive, or "none">

### Tests

- mobile: <claim the screen test proves>
- e2e: <claim only a running app can show> (`apps/mobile/e2e/<id>.ad`)
- <contract: / api: lines when it crosses the wire>

### Shipped-features entry

<!-- Defaults 8. "none (not a visitor's feature)" for maintenance of the app's own chrome. -->

- id `<kebab-id>`, title "<title>", summary "<one sentence>"
