<!--
Task spec. A spec session writes this as a sub-issue of a feature, from a
slice the developer listed under the feature's Technical spec > Tasks.
A task is task:draft until the Technical spec is filled in, the approval box
is ticked, and every issue under "Depends on" is closed.
-->

Part of #NNN.

## Scope

<!-- The slice of the parent's outcome this task delivers: what a user can do
after this PR merges that they could not after the previous one. -->

## Technical spec

### Packages and modules touched

### Contract changes

<!-- Every schema added or changed in packages/contract. "none" otherwise. -->

### Native change

<!-- "none — JS only, ships over the air", or what is native and why. -->

### Rules in play

<!-- Which files in docs/internal/agent-rules/ the implementer must reread, and why. -->

### Failure modes and limits

<!-- What the user sees when something this slice touches fails or is out of
bounds, and every bound it enforces, with its number. "none" only if nothing
can fail. -->

### Agent hooks

<!-- appduct tools, deep links, and the testID and accessibility label of each
element the simulator lines and e2e: tests below rely on. A new tool: name,
input, output, read-only or destructive. "none" when nothing needs the app
running. -->

### Tests

<!-- Each line is a test title: a claim the body must prove. Prefix with the
package: "contract:", "api:", "mobile:", or "e2e:" for an agent-device replay
script under apps/mobile/e2e/ (only for a claim a running app must show). -->

- ...

## Done when

<!-- Observable checks a reviewer runs before merging. A line that needs the
app running on a simulator says so, and names what a device check reads:
"on the simulator: `shipped-feature-12` reads 'Confetti button'". -->

- ...

## Out of scope

## Depends on

<!-- One issue per line. Leave empty if none. -->

- #NNN

## Approval

- [ ] Approved for delivery
