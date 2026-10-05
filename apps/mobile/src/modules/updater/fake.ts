import type { RunningBundle, Updater } from "./port";

export type FakeUpdate = {
  id: string;
  message?: string | null;
  rollback?: boolean;
  forced?: boolean;
  downloads?: boolean;
};

export type FakeUpdater = Updater & {
  offer(next: FakeUpdate | Error | null): void;
  runBundle(next: Partial<RunningBundle>): void;
  readonly checks: number;
  readonly downloads: number;
  readonly reloads: number;
};

export const FAKE_EMBEDDED_BUNDLE_ID = "0199a000-0000-7000-8000-000000000000";

export function createFakeUpdater(): FakeUpdater {
  let offered: FakeUpdate | Error | null = null;
  let bundle: RunningBundle = {
    id: FAKE_EMBEDDED_BUNDLE_ID,
    embedded: true,
    channel: "production",
  };
  let checks = 0;
  let downloads = 0;
  let reloads = 0;

  return {
    serverUrl: "http://ota.test/hot-updater",
    start() {},
    async check() {
      checks += 1;
      if (offered instanceof Error) throw offered;
      if (!offered) return null;
      const update = offered;
      return {
        id: update.id,
        message: update.message ?? null,
        rollback: update.rollback ?? false,
        forced: update.forced ?? false,
        download: async () => {
          downloads += 1;
          return update.downloads ?? true;
        },
      };
    },
    async reload() {
      reloads += 1;
    },
    runningBundle: () => bundle,
    fingerprint: () => "fake-fingerprint",
    offer(next) {
      offered = next;
    },
    runBundle(next) {
      bundle = { ...bundle, ...next };
    },
    get checks() {
      return checks;
    },
    get downloads() {
      return downloads;
    },
    get reloads() {
      return reloads;
    },
  };
}
