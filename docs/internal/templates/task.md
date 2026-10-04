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

### Tests

<!-- Each line is a test title: a claim the body must prove. Prefix with the
package: "contract:", "api:", "mobile:", or "flow:" for a Maestro flow. -->

- ...

## Done when

<!-- Observable checks a reviewer runs before merging. A line that needs the
app running on a simulator says so: "on the simulator: ...". -->

- ...

## Out of scope

## Depends on

<!-- One issue per line. Leave empty if none. -->

- #NNN

## Approval

- [ ] Approved for delivery
