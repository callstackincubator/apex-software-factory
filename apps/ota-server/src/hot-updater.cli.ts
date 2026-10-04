/**
 * Entry point for `hot-updater db migrate|generate` (see the `db:*` scripts).
 * The CLI imports this file and reads the `hotUpdater` and `closeDatabase`
 * exports; it builds the instance from the same environment as `main.ts`.
 */
import { loadConfig, loadDotEnv } from "./config.ts";
import { createOtaHotUpdater, openDatabase } from "./hot-updater.ts";
import { createS3Storage } from "./storage.ts";

loadDotEnv();
const config = loadConfig(process.env);
const db = openDatabase(config.databasePath);

export const hotUpdater = createOtaHotUpdater({ db, storages: [createS3Storage(config.s3)] });

export async function closeDatabase(): Promise<void> {
  await db.destroy();
}
