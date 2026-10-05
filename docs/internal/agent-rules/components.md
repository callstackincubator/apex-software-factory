# Agent rules: components

Where a React Native component lives and what shape it takes (ADR 0024).
These sit on top of `modules.md`. Violating one is grounds for rejecting a
change even if the screen looks right.

1. **A component belongs to the feature that uses it.** A component used by
   one feature module lives in that module and is not exported unless a
   route needs it. Two features that need the same thing do not import it
   from each other. If it really is generic, it moves to `ui` (rule 2).
   Otherwise each feature keeps its own.

2. **The `ui` module is the design system.** `src/modules/ui` holds the
   design tokens (`useTheme`, `space`, `fonts`), the app-wide providers
   (`AppKeyboardProvider`), and the components that are reusable by design:
   they know nothing about any feature, take no feature data, and fetch
   nothing. `Card`, `LiveDot` and `SectionLabel` are there. `ui` imports
   no other module. Colours, spacing and fonts come from its tokens, never
   from literals in a feature.

3. **A reusable component with parts is a compound component.** A `ui`
   component made of more than one part is a root plus named parts, attached
   to it and composed by the caller:

   ```tsx
   <Card testID="schedule-item-3">
     <Card.Title>Keynote</Card.Title>
     <Card.Body>Opening of reactCon Berlin.</Card.Body>
     <Card.Meta>10:00 · Main stage</Card.Meta>
   </Card>
   ```

   Not `<Card title=… body=… meta=… showMeta />`. A new variation is a new
   part, or a different arrangement of the parts, never another boolean
   prop. State the parts share goes through a context the root provides,
   never through props threaded by the caller. A component with one part
   (`LiveDot`) is just a component.

4. **Promote, do not predict.** A component moves into `ui` when a second
   feature needs it, not before. The move happens in the PR that adds the
   second use, and the first feature switches to the `ui` version in the
   same PR.
