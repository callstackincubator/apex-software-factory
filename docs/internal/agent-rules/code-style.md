# Agent rules: code style

Rules for how code reads, in every app and package. Formatting and lint are
the tools' job (`pnpm format`, `pnpm lint`); these cover what the tools
cannot. Violating one is grounds for rejecting a change.

1. **No comment by default.** Names, types and tests say what code does. A
   comment is written only where a careful reader would otherwise get the
   code wrong: a workaround for a library bug, an order that matters, a
   value that looks wrong but is not, a `require` where an `import` would
   break the bundle. It says *why*, in one or two lines. If removing a
   comment would not mislead anyone, remove it.

2. **No comment restates the code.** That rules out a doc comment that
   repeats a function's name ("Checks the API health"), a field comment
   that repeats its type, a banner above a section, a comment explaining
   what the next line does, and commented-out code. A comment that points
   to where something is documented is not needed either: the rule files
   and `AGENTS.md` are already where readers look.

3. **Documentation lives where its reader looks.** How to use a module
   belongs in its `index.ts` exports and their types. How the app is built
   belongs in `apps/mobile/AGENTS.md`, `README.md` and `TESTING.md`. Rules
   belong in `docs/internal/agent-rules/`, and the meaning of a wire field
   belongs in the contract schema's `.describe()`, which reaches the
   OpenAPI document. None of these belong in a comment.

4. **A comment that remains is part of the change.** Architecture rule 10
   applies: when the code under a comment changes, the comment is checked
   too. One that is no longer true is a defect.
