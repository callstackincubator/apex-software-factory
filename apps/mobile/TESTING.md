# Testing the app: a cookbook

How tests are written in `apps/mobile`, so nobody has to read `node_modules`
to find out. The rules are in `docs/internal/agent-rules/testing.md`; this is
the how. Copy the closest recipe.

## Setup you get for free

- Jest with the `jest-expo` preset; tests live in their module's `__tests__/`
  (`src/modules/status/__tests__/status-footer.test.tsx`). Import the module
  under test from `..`; import other modules only by `@/modules/<name>`.
- `@testing-library/react-native` **14**: `render`, `fireEvent.*` and `act`
  return promises — always `await` them. Matchers like `toBeOnTheScreen()` are
  loaded. A test that fails while an un-awaited `render` still has an effect in
  flight leaves Jest unable to exit; the config sets `forceExit` so that run
  ends instead of hanging, but the test is still wrong. The "Force exiting
  Jest" line after every run is that setting, not a problem to chase.
- `jest.setup.ts` sets up Reanimated and, before every test, puts every port
  module on its fake: the updater offers no update and runs the embedded
  bundle on channel `production`, and the API is unreachable. A test that
  needs something else sets its own fake (below). `jest.resolver.js` makes
  Reanimated and Worklets resolve under pnpm. Do not touch either for a
  feature, except to add a new port module's fake to `jest.setup.ts`.
- The `@/` alias is `src/`.

Run one file, not the suite: `pnpm --filter @apex/mobile exec jest src/modules/status/__tests__/status-footer.test.tsx`.

## A component

```tsx
import { fireEvent, render, screen } from "@testing-library/react-native";

import { StatusFooter } from "..";

// jest-expo's expo-constants mock carries no app config.
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { expoConfig: { version: "1.0.0" } },
}));

// The API row's label carries the round trip ("API status: ok · v1.4.0 · 42 ms"),
// so fix the clock the footer measures with (see "A plain function or hook").
let t = 0;
const now = () => (t += 42); // two calls per check, 42 ms apart → a 42 ms round trip

it("shows the API version once healthy, and re-checks on press", async () => {
  await render(<StatusFooter now={now} />);
  expect(await screen.findByText("ok · v1.4.0")).toBeOnTheScreen(); // findBy* waits for effects
  await fireEvent.press(screen.getByRole("button", { name: "API status: ok · v1.4.0 · 42 ms" }));
});
```

Query what a user (or agent-device) sees: `getByRole(role, { name })` with the
accessibility label, `getByText`, `getByTestId("status-api")`. Assert a label
with `expect(el).toHaveAccessibleName("…")` or
`getByLabelText("…")`. Use `findBy*` after anything async, `queryBy*` to assert
absence (`expect(screen.queryByTestId("x")).toBeNull()`).

A whole screen needs the safe-area mock:

```tsx
jest.mock(
  "react-native-safe-area-context",
  () => require("react-native-safe-area-context/jest/mock").default,
);
```

## Port modules: drive the fake

Never `jest.mock` an SDK or a module to fake a third-party API. Set the port
module's fake and drive it:

```tsx
import { createFakeUpdater, type FakeUpdater, setUpdater } from "@/modules/updater";

let updater: FakeUpdater;
beforeEach(() => {
  updater = createFakeUpdater();
  setUpdater(updater);
});

updater.offer({ id: "0199b111-…", message: "Add a confetti button" }); // next check finds it
updater.offer(new TypeError("Network request failed")); // next check fails
expect(updater.reloads).toBe(1);
```

The API's fake is the real contract client over a fake `fetch`, so the
response goes through the zod schema like in the app. Never mock `fetch`
globally and never hand-write response types:

```tsx
import { createFakeApiClient, setApiClient } from "@/modules/api";

setApiClient(
  createFakeApiClient(async () =>
    Response.json({ status: "ok", version: "1.4.0", uptimeSeconds: 12 }),
  ),
);
// failure: () => Promise.reject(new TypeError("Network request failed"))
// contract break: async () => Response.json({ status: "degraded" })
```

A real adapter is tested once, in its own module, against the SDK's mock in
`__mocks__/` (`src/modules/updater/__tests__/hot-updater.test.ts`).

## Domain events

Assert an event the way another module would see it: subscribe, act, check
the payload, unsubscribe.

```tsx
import { events } from "@apex/event-bus";

const staged = jest.fn();
const off = events.on("ota/update-staged", staged);
// … act …
off();
expect(staged).toHaveBeenCalledWith({
  id: "0199b111-…",
  message: "Add a confetti button",
  rollback: false,
});
```

To test a listener, emit the event with `events.emit(...)` and assert on what
it did.

## A plain function or hook

Test pure logic directly (`checkApiHealth()` from `@/modules/status`).
Inject what varies — a clock, a timeout, a client — as a parameter with a
default, and pass a fixed one in the test:

```ts
// production: export function timeIt(work: () => Promise<void>, now = () => performance.now())
let t = 1000;
const now = () => (t += 42); // each call advances 42 ms
expect(await timeIt(async () => {}, now)).toBe(42);
```

A hook is easiest to test through the component that uses it; for a hook alone
use `renderHook` from `@testing-library/react-native`.

## Fake timers

For polling, delays and timeouts (see `src/modules/ota/__tests__/update-banner.test.tsx`):

```tsx
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

await act(async () => {
  jest.advanceTimersByTime(CHECK_INTERVAL_MS); // export the constant from the module
});
```

Never wait for real time in a unit test, and never let a test pass only by
timing out (testing rule 2).

## appduct tools

Tools are plain handlers over injected dependencies (`src/modules/agent-tools/tools.ts`,
`src/modules/<id>/agent-tools.ts`). Test the handler: build its deps with
`jest.fn()`s and set the port fakes, call it, assert the returned object.
`src/modules/agent-tools/__tests__/tools.test.ts` has `makeDeps()` and the
`@appduct/react-native` mock to copy.

## testIDs and selectors

Every element a device check reads has a kebab-case `testID`, unique on its
screen, and an `accessibilityLabel` stating what it shows
(`apps/mobile/AGENTS.md`). Jest selects by role, label or `testID`; agent-device
by `id="…"` or `label="…"`. Renaming one breaks `e2e/*.ad`.

## An `.ad` script (`e2e:` test)

`apps/mobile/e2e/<name>.ad`, run on a leased device with
`.agents/scripts/device-lane.sh ad replay apps/mobile/e2e/<name>.ad`:

```
# <the claim, word for word from the spec's Tests line>
context platform=ios timeout=120000
env APP_ID=com.callstack.apexfactory
open ${APP_ID} --relaunch
wait id="home-headline" 60000
scroll bottom
is visible id="status-api"
press id="status-api"
wait absent "label=\"API status: checking…\"" 10000
is visible id="status-app"
close
```

Select by `id="…"` or an exact `label="…"` — partial label matching does not
work in `.ad` scripts on the pinned agent-device. End each check on a named
assertion (`is`, `wait`, `get`). A value that changes every run (a time, a
count) is checked for presence on the device and for its format in Jest.
