import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { Kysely, SqliteDialect, type SqliteDatabase } from "kysely";
import { createHotUpdater, type RuntimeHotUpdaterAPI } from "@hot-updater/server";
import { kyselyAdapter } from "@hot-updater/server/adapters/kysely";
import type { OtaContext, OtaStorage } from "./storage.ts";

export const HOT_UPDATER_BASE_PATH = "/hot-updater";

export type OtaHotUpdater = RuntimeHotUpdaterAPI<OtaContext>;

/** Opens the SQLite file (or `:memory:`), creating its directory if needed. */
export function openDatabase(path: string): Kysely<object> {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");
  return new Kysely<object>({
    dialect: new SqliteDialect({ database: bindBooleansAsIntegers(sqlite) }),
  });
}

/**
 * hot-updater's Kysely adapter (0.36.x) binds JS booleans (`enabled = true`,
 * inserts of `enabled`/`should_force_update`), which better-sqlite3 refuses:
 * "SQLite3 can only bind numbers, strings, bigints, buffers, and null". SQLite
 * stores booleans as 0/1 anyway, so convert them at the driver boundary.
 */
function bindBooleansAsIntegers(sqlite: Database.Database): SqliteDatabase {
  const bind = (parameters: readonly unknown[]) =>
    parameters.map((value) => (typeof value === "boolean" ? Number(value) : value));
  return {
    close: () => sqlite.close(),
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      return {
        reader: statement.reader,
        all: (parameters) => statement.all(bind(parameters)),
        run: (parameters) => statement.run(bind(parameters)),
        iterate: (parameters) => statement.iterate(bind(parameters)),
      };
    },
  };
}

export function createOtaHotUpdater(options: {
  readonly db: Kysely<object>;
  readonly storages: readonly OtaStorage[];
}): OtaHotUpdater {
  return createHotUpdater<OtaContext>({
    database: kyselyAdapter({ db: options.db, provider: "sqlite" }),
    storages: options.storages,
    basePath: HOT_UPDATER_BASE_PATH,
    // Management routes are what the CLI's standaloneRepository talks to;
    // app.ts puts them behind the bearer token.
    routes: { updateCheck: true, bundles: true },
  });
}
