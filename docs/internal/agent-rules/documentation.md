# Agent rules: documentation

Rules for anyone (human or agent) writing or editing documentation, or any
user-visible string the app or a service shows. Violating these is grounds
for rejecting a change even if the prose reads well.

1. **There are two audiences, and they get two places.** End-user docs —
   for someone using the app, calling the API, or running the factory at the
   booth — live directly under `docs/` and in `README.md`. Maintainer and
   agent docs — ADRs, agent rules, delivery, templates, OTA internals — live
   under `docs/internal/`, plus `AGENTS.md` at the root. Before adding a doc
   file, decide which reader it is for and put it in the matching place; do
   not add a third category. One exception: `docs/FACTORY.md` and
   `docs/BOOTSTRAP.md` are written for the developers and maintainers who run
   the factory, so they may cite ADRs and link into `docs/internal/`. Every
   other file directly under `docs/` stays end-user only.

2. **An end-user doc never cites an ADR and never links into
   `docs/internal/`.** A reader using the app does not need to know a decision
   record exists. If a sentence's only content is "see ADR NNNN", state the
   fact directly and drop the citation, or delete the sentence.

3. **Nothing the running software shows names a file in this repository.**
   Screens, error messages, HTTP error bodies and the API's OpenAPI
   descriptions must not tell a user to read a markdown file. Say the thing
   directly, or point at the repository URL if a pointer is needed at all.

4. **A doc that serves both audiences is split, not shared.** The end-user
   version says what and how; the internal one adds why and the ADR
   references. A change that touches one updates both in the same PR.

5. **Casing follows the directory.** Files directly under `docs/` and
   `docs/internal/` are `UPPER-CASE.md`. `docs/internal/adr/`,
   `docs/internal/agent-rules/` and `docs/internal/templates/` use
   `lower-case.md`. Match the directory a new file lands in.

6. **Links between the two run in one direction only**: from `docs/internal/`
   out to `docs/` (e.g. `../API.md`) is fine; from `docs/` into
   `docs/internal/` never is (rule 2) — except from `docs/FACTORY.md` and
   `docs/BOOTSTRAP.md`, the two maintainer docs rule 1 names.

7. **A claim in a doc is part of the change.** If a change makes a doc
   paragraph, a comment, a screen's copy or a test title false, the same PR
   fixes or deletes it. The implementer searches `docs/`, `README.md` and the
   user-facing strings it touched for claims its change makes false.
