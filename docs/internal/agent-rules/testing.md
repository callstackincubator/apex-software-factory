# Agent rules: testing

Rules for writing tests in this repo. A test is a claim about behaviour that
outlives the person who wrote it, so these are binding in the same way the
other files here are: a change whose tests violate them is rejected even
though the suite is green — being green is exactly the failure mode.

1. **A test's title is a claim, and the body must prove that claim.** A title
   that promises more than the body asserts is a defect, not a wording
   problem: it tells every later reader the case is covered when it is not.
   If the body cannot prove the title, narrow the title to what it does prove.
   The same goes for a comment above a test explaining what it guards. The
   Tests lines of a spec are test titles; the test that implements one keeps
   its words.

2. **Every test must be able to fail, for the right reason.** Before you trust
   a test, break the code it covers, run it, and watch it fail on a _named
   assertion_ — then restore the code. A test that still passes is a green
   light wired to nothing. A test that fails only by timing out pins the
   schedule rather than the behaviour. Red-first delivery (the spec's tests
   are committed failing before the code exists) is how this is shown for new
   code. Prove it with the test's own file
   (`pnpm --filter <package> exec vitest run <file>`, or `exec jest <file>`
   for `@apex/mobile`), not the whole suite: CI runs `pnpm check` on every
   push.

3. **Production code that can be deleted with a green suite is untested.** For
   a new code path, delete it and run its tests. If nothing goes red, whatever
   you believed covered it stops short of the part that matters — usually
   because the test exercises an internal callback rather than the observable
   output: the HTTP response, the parsed contract value, the text on screen.
   Write the test that goes red, then restore the code. Run the affected
   test file, not the suite. The code reviewer does this, to at most three
   changed paths per review — the ones where a wrong answer would hurt a user
   most — and reads the rest (ADR 0009). The implementer's proof is red-first
   (rule 2); it does not probe.

4. **A test that enforces a rule must see everything the rule covers.** A
   boundary or invariant test enforces its rule only where it looks. One that
   scans a single directory, follows only static imports, or checks only the
   first element of a collection leaves the rest unguarded — and reads, to
   everyone after you, as though the whole rule were covered.

5. **A flake is not diagnosed until it reproduces on a commit that predates
   the change.** "Probably unrelated" and "it passed when I re-ran it" are
   guesses. Check out the base commit, run the same test, and let the result
   decide. Never skip, disable, or quarantine a test to get to green. Once a
   failure has reproduced on a base commit, an open issue labelled
   `flaky-test` names the test by file and title; a failure that matches one
   skips the base-commit run and links the issue in the PR instead. One that
   reproduced on base and has no issue gets a `bug:new` issue with that label.

6. **Each layer is tested where it lives, at the cheapest level that proves
   the claim.** A contract shape is tested in `packages/contract` (vitest:
   what it accepts and what it refuses). An API route is tested in
   `apps/api` with `app.request()` in-process — no port, no network. A screen
   is tested in `apps/mobile` with a Jest render test against what the user
   sees, with every port module on its fake (modules rule 11) and the API
   client replaced at the contract boundary
   (`setApiClient(createFakeApiClient(...))`). Only a claim
   that needs a running app on a device — navigation across native screens,
   an OTA update applying — becomes an agent-device replay script
   (`apps/mobile/e2e/<name>.ad`, an `e2e:` test), run on a leased device
   (delivery rule 16). It selects elements by `testID` or accessibility
   label, never by coordinates, and fails on a named check (`is`, `wait`,
   `get`), not on a timeout alone. It may reach its starting state through
   an appduct tool or a deep link the spec names instead of tapping there. A
   unit test never needs a device, the network, or a running service.

7. **Test what the user can see, through the module's front door.** A screen
   or component test renders it and acts the way a person does: it finds
   elements by role, text, label or `testID`, presses and types, and asserts
   on what appears. A logic test calls what the module exports and asserts
   on what comes back or what it emitted. Neither asserts on internal state,
   on which hook or function was called, on a component's props, or on a
   snapshot. Those break on refactors that change nothing for the user and
   pass on bugs that do. Mock only at the edges the app does not own: port
   modules (through their fakes), timers, and the platform.

8. **Aim for confidence, not coverage.** There is no coverage target, and a
   line is not worth a test just because it exists. Spend tests where a
   regression would hurt a visitor or a release most: what the user sees and
   does, failure and empty states, the edges of a contract, the translation
   a real adapter does, anything with a timeout or a retry. Do not write a
   test for a type, a constant, a style, or a pass-through that the tests
   above already exercise. One test that walks a real flow is worth more
   than five that pin implementation details. When a test costs more to
   keep than the bug it would catch, delete it.
