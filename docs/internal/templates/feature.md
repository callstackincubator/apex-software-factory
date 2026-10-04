<!--
Feature spec. A spec session writes this; nobody edits it by hand.

Sections from "Problem" to "Open questions" are the business spec. The product
owner owns them: outcomes a user can see, never implementation detail unless
the detail is itself a requirement.

"Decisions" and "Technical spec" belong to a developer. A filled Technical
spec is what lets agents deliver the feature unattended; the developer sets
feature:ready when it is done. A feature too big for one PR lists its slices
under "Tasks" and the delivering agent turns each into a task sub-issue.
-->

Request: #NNN <!-- the request:new issue this came from, or "none" -->

## Problem

<!-- What is missing or wrong in the app today, in one or two paragraphs, in
the visitor's terms. -->

## Who it is for

<!-- The person who has the problem, and the situation they are in. -->

## Outcome

<!-- What they can do after this lands that they cannot do now. Observable
behaviour only: what they see and what they tap. -->

## Non-goals

<!-- What this feature deliberately does not do, so nobody scopes it back in. -->

## Completion conditions

<!-- How anyone would check the outcome on a phone running the update. Each
line is something a person or a test can verify against main. -->

- ...

## Open questions

<!-- Anything unresolved. Empty before the feature leaves feature:spec. -->

## Decisions

<!-- One line per ADR this feature depends on, or "none". -->

- ADR NNNN — <title>: <one line on what it fixes for this feature>

## Technical spec

<!-- Written by a developer. Everything an agent needs to build this without
asking. -->

### Packages and modules touched

<!-- packages/contract, apps/api, apps/mobile: files or modules, one line each. -->

### Contract changes

<!-- Every schema added or changed in packages/contract, with its fields. "none"
if nothing crosses the wire. -->

### Native change

<!-- "none — JS only, ships over the air", or what is native (a new
dependency with native code, an app.json plugin) and why it cannot be avoided. -->

### Rules in play

<!-- Which files in docs/internal/agent-rules/ the implementer must reread, and why. -->

### Tests

<!-- Each line is a test title: a claim the body must prove. Prefix with the
package: "contract:", "api:", "mobile:", or "flow:" for a Maestro flow. -->

- ...

### Tasks

<!-- Only when the feature needs more than one PR: one line per slice, in
order, "title — what a user can do after it merges". Delete otherwise. -->
