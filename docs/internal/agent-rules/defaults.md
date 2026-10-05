# Agent rules: defaults

The house answers for whatever a spec leaves unsaid (ADR 0011). A spec only
writes what is specific to its feature; everything below applies unless the
spec says otherwise. The implementer builds them without asking, the spec
reviewer treats them as part of every spec, and the spec checker does not
report a gap these answer. A spec that wants something different says so in
its own words, and the spec wins.

A question these rules, the other agent rules and the spec all leave open is
not a reason to stop: the implementer takes the conservative option and
records it as an `Assumption:` line in the PR body (delivery rule 3).

## Screens

1. **Loading shows a skeleton.** While a screen or section waits for data, it
   shows placeholder shapes the size of the content (theme `surface` colour,
   no spinner over content), and keeps what it already had while it
   refreshes. A wait under 300 ms shows nothing.

2. **A failed request shows an inline error with a retry.** The section that
   failed says so in one short sentence in place of its content ("Couldn't
   load the schedule.") and offers a "Try again" button that repeats the
   request; the rest of the screen keeps working. Never a blocking alert,
   never a blank screen, never a raw error message or status code. Every
   request has a timeout: 5 seconds, as `checkApiHealth` does.

3. **Empty is a state, not a blank.** A list or section with nothing in it
   says what will be there and how it gets there, in one sentence, like the
   "Nothing shipped yet" line on the home screen.

4. **Offline is normal at a booth.** Venue Wi-Fi drops; the app never
   crashes or hangs without the network. What was shown stays shown;
   actions that need the network fail with rule 2's inline error. Nothing is
   queued to send later unless the spec asks for it. The API is optional for
   this app: no screen may depend on it to render at all.

5. **Every element a person or an agent reaches has a `testID` and an
   accessibility label.** The `testID` is kebab-case and unique on its screen
   (`schedule-item-3`); the label states what the element shows or does
   ("Talk: Hermes internals, 14:00"), and buttons have
   `accessibilityRole="button"`. Text respects Dynamic Type
   (`maxFontSizeMultiplier` 1.6 on dense rows), and colours come from
   the `ui` module's tokens in light and dark.

6. **Copy is short, plain and friendly.** Sentence case, no exclamation
   marks, no jargon a visitor would not use ("Couldn't load", not "Request
   failed: 503"), no blame ("Something went wrong", not "You did"). At most
   one sentence per message. Numbers keep their unit ("120 ms").

## Each new screen or feature

7. **It is reachable and testable by an agent.** A new screen has a route
   under `src/app/`, a deep link (`apexfactory:///<route>`), and an appduct
   tool under `src/modules/<id>/agent-tools.ts` that opens it or seeds its
   state (`apps/mobile/AGENTS.md`). It has at least one `e2e:` agent-device
   replay script (`apps/mobile/e2e/<id>.ad`) whose first comment line is
   the claim it proves.

8. **A shipped feature is listed.** A feature a booth visitor proposed gets
   an entry in `shippedFeatures` (`src/modules/registry/index.ts`): id, title,
   one-sentence summary, issue number, merge date, and `href` when it has a
   screen. A maintenance change to the app's own chrome (the footer, the
   banner) is not a shipped feature and gets no entry.

## Data and limits

9. **Everything from the wire is bounded before use** (safety rule 3). When
   the spec names no number: a request body at most 16 KiB, a single text
   field at most 280 characters, a list at most 100 items per response
   (the screen shows the first 100 and says how many more there are), an
   id at most 64 characters. The bound lives in the contract schema
   (architecture rule 8), so the API and the app enforce the same one.

10. **The app keeps nothing about a visitor.** No account, no tracking, no
    analytics, no free text stored beyond what the feature needs to show it
    back, nothing persisted that names a person (safety rule 7). Local state
    that must survive a restart is kept on the device only, and only when
    the spec says so.

11. **No native change by default.** A feature uses what the installed
    binary has (`docs/internal/NATIVE-CAPABILITIES.md`). A spec that needs
    more says so in its Native change line; otherwise a new native
    dependency, permission or `app.json` key is a contradiction with the
    spec, not an assumption (delivery rule 17).
