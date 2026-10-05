# 0024 — Feature modules, a domain event bus, ports and adapters; rules are files

Status: Accepted

## Context

The factory writes the booth app unattended, one visitor's idea at a time,
and the app is meant to be maintainable after the conference. Without house
rules for how code is laid out, each run makes its own choices, and the
code drifts with every PR. Before this decision the mobile app was split by
layer (`components/`, `lib/`, `dev/`, `features/`), screens imported each
other's files freely, `@hot-updater/react-native` was imported from five
places, and most functions carried a doc comment repeating their name.

The rules also have to reach the agents. There were two ways to do it:

- **Skills.** Skills load when the model decides one fits. ADRs 0019 and 0022
  limit which agent may load which skill, and the blind code reviewer loads
  none of them. A rule that might not be read is not a rule.
- **Rule files** in `docs/internal/agent-rules/`, pointed at from
  `AGENTS.md`. `review-inputs.sh` copies every rule file from the base
  branch into the code reviewer's inputs, so a PR cannot weaken the rules it
  is judged by. The spec reviewer gets the files a spec lists under Rules in
  play. The `implement` skill names the files it follows.

## Decision

1. **Rules are files, not skills.** Architecture, components, code style and
   testing rules live in `docs/internal/agent-rules/`, and `AGENTS.md` routes
   to them. Skills stay procedures: how to do a task, not what a change must
   satisfy.
2. **Feature modules.** App code lives in `src/modules/<name>/`. Each module
   has one public API, its `index.ts`, and no other module, route or shell
   file imports anything behind it (`modules.md`).
3. **Actions are calls; side effects are events.** A module asks another to
   do something by calling its public API. It tells whoever cares that
   something happened by emitting a typed domain event on `@apex/event-bus`.
   The bus is a new workspace package used by both apps: synchronous, in
   process, and typed through a `DomainEvents` interface that each module
   augments with its own events.
4. **Ports and adapters for third-party APIs.** Every SDK or service that
   does I/O gets a port module named after the capability. It has a port in
   the app's terms, a real adapter, and a fake. The mobile app reaches the
   adapter through the module's getter, and tests swap in the fake. The API
   passes adapters through `createApp(deps)`, its existing composition root.
5. **Components.** A component one feature uses lives in that feature. The
   design system is the `ui` module. A reusable component with parts is a
   compound component (`components.md`).
6. **Few comments** (`code-style.md`), and **tests for confidence, not
   coverage** (`testing.md` rules 7 and 8).
7. **One checker enforces the import rules.** `tools/module-boundaries`
   flags deep imports, imports of a module's own files through its alias,
   and third-party packages imported outside their owning module. It reads
   every `import`, `export … from`, `require()`, `import()` and `jest.mock()`
   in `apps/mobile/src` and `apps/api/src`. Lefthook runs it before each
   commit, and `pnpm check` runs its test in CI. It is not an oxlint rule:
   `no-restricted-imports` cannot tell a module's own relative imports from a
   deep import into a neighbour, and architecture rule 8 allows only one
   place to enforce a rule.

The existing code was reorganised to match in the same change: `ui`, `home`,
`status`, `ota`, `registry`, `agent-tools`, `capabilities`, `devtools`, and
the port modules `updater` (hot-updater) and `api` (the contract client) in
the app, and the `health` module in the API.

## Consequences

- A visitor's feature is one new directory under `src/modules/` plus a
  route file, and its review diff stays in one place.
- Adding an SDK always takes a decision: a port module and a line in
  `tools/module-boundaries/config.js`. The checker fails until both exist.
- Unit tests run against fakes by default (`jest.setup.ts`), so none of them
  reaches the network or a native module by accident. The cost is a fake to
  keep in step with each port. The real adapter's own test is what catches
  the two drifting apart.
- The `capabilities` module may import any native package, because probing
  them all is its job. It is the one exception in the checker's config.
- `@apex/event-bus` is synchronous. A listener that needs async work starts
  it and returns. The emitter neither waits for it nor sees its failure.
- Agent rules for the spec reviewer stay opt-in: a spec lists `modules.md`
  or `components.md` under Rules in play when its feature adds a module, an
  event, a port or a `ui` component. The code reviewer always has every rule
  file.
