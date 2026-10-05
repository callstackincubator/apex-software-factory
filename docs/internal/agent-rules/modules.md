# Agent rules: modules

How code is organised inside an app (ADR 0024). `architecture.md` draws the
lines between apps and packages; this file draws them inside `apps/mobile`
and `apps/api`. Violating one is grounds for rejecting a change even if it
works. `node tools/module-boundaries/cli.js` checks rules 2, 3 and 9 on every
commit and in CI (`pnpm check`); the rest are for the reviewer.

## Modules

1. **A feature is a module.** Each one is a directory under `src/modules/`,
   named after what it does for the user (`ota`, `status`, `schedule`), not
   after a layer (`hooks`, `utils`, `components`). It owns its screens,
   components, hooks, state, events, agent tools and tests. What stays
   outside modules is the shell: `src/app/` (routes) in the mobile app, and
   `app.ts`, `main.ts`, `config.ts`, `context.ts`, `router.ts`, `errors.ts`,
   `logger.ts` and `middleware/` in the API. A route file only re-exports a
   screen from a module (`export { HomeScreen as default } from "@/modules/home"`).

2. **`index.ts` is a module's public API, and the only way in.** Another
   module, a route or the shell imports `@/modules/<name>` (the API uses
   `../<name>/index.ts`), never a file behind it. Not by alias, not by a
   relative path, not with `require()` or `jest.mock()`. Something another
   module needs is exported from `index.ts`. Anything not exported is free
   to change.

3. **Inside a module, imports are relative.** A module never imports itself
   through `@/modules/<own name>`. Its tests live in its `__tests__/` and may
   import its internal files.

4. **Keep the public API small.** Export what callers use today, not what
   they might use one day. A type exported for one caller is still an
   export. Prefer exporting a component or a function over exporting the
   hook or state it is built from.

5. **Dependencies between modules point one way.** If module A imports B, B
   does not import A, not even for a type. When two modules seem to need
   each other, one of them should react to the other's event instead (rule 7).

## Events and actions

6. **An action is a direct call.** When a module needs another module to do
   something now and cares about the answer (check for an update, show the
   banner, load a list), it calls a function from that module's `index.ts`
   and uses the result. Commands do not go through the event bus.

7. **A side effect is a reaction to a domain event.** When something has
   happened in module A and module B should react to it (post an appduct
   event when a bundle is staged, refresh a list when an item is saved), A
   emits an event and B subscribes. A never imports B to tell it, and A does
   not know who is listening. Cross-module synchronisation always works this
   way.

8. **Events are typed, past tense, and declared by the module that emits
   them.** The bus is `events` from `@apex/event-bus`: synchronous and
   in-process. Each module adds its events to the shared `DomainEvents`
   interface in its own `index.ts`, through interface augmentation:

   ```ts
   declare module "@apex/event-bus" {
     interface DomainEvents {
       "ota/update-staged": { id: string; message: string | null; rollback: boolean };
     }
   }
   ```

   The name is `<module>/<what-happened>`, in kebab-case and the past tense.
   Only the module named in the event emits it. The payload is plain,
   serialisable data: ids and values, never a class instance, a callback or
   a mutable object. A listener subscribes where its module starts up (a
   hook's effect, an `install` function the shell calls), and keeps the
   unsubscribe function `on()` returns. A listener that throws is reported
   and skipped, so the emitter never fails because a side effect did.

## Ports and adapters

9. **A third-party API is reached only through its port module.** A
   third-party API is any SDK or service the app does not own whose calls
   do I/O or touch the device: an OTA server, storage, the file system,
   location, the camera, notifications, a payment provider, another
   company's HTTP API. Each one gets a module of its own, named after the
   capability, not the vendor (`updater`, `file-system`, `storage`), and
   only that module imports the package. `tools/module-boundaries/config.js`
   lists the packages any file may use (React, React Native, Expo Router,
   UI and animation libraries, zod, the workspace packages) and which
   module owns each of the rest. A package on neither list fails the check,
   so adding an SDK always means adding or extending a port module.

10. **A port module has a port, a real adapter and a fake.** `port.ts`
    describes the capability in the app's own words and types; no type from
    the SDK appears in it. The real adapter (named after the SDK, e.g.
    `hot-updater.ts`) is the only file that imports the package. The fake
    (`fake.ts`) is in-memory, deterministic, and has controls a test can
    drive (`offer()`, `runBundle()`) and read (`checks`, `reloads`).
    `index.ts` exports the port's types and the fake, never the real
    adapter. The `updater` module is the reference.

11. **The mobile app gets an adapter from the port module's getter.** The
    index exports `get<Port>()`, which builds the real adapter on first use,
    and `set<Port>()`. Code calls the getter when it needs the port, never
    at import time. Only `jest.setup.ts`, a test, and the root layout call
    the setter. `jest.setup.ts` installs every fake before each test, so a
    unit test never reaches a real SDK by accident.

12. **The API gets its adapters through `AppDeps`.** `createApp(deps)` is
    already the API's composition root, so there a port module exports a
    `create<Port>()` factory as well as the fake. `main.ts` passes the real
    adapter, and tests pass the fake. Route modules read it from `deps`.

13. **A real adapter is tested against the SDK, once.** Its tests check the
    translation the port hides, against the package's Jest mock or a local
    server: how a rollback, a missing field or an error from the SDK maps
    onto the port. Everything else is tested against the fake.
