---
description: Deliver a ready issue end to end, unattended — /deliver <n>
agent: factory
---

Load the `deliver` skill and deliver issue #$ARGUMENTS end to end.

If no issue number was given, take the oldest unclaimed issue labelled
`task:ready`, `bug:ready` or `feature:ready`.
