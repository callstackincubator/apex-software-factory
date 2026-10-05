import { openDatabaseSync } from "expo-sqlite";
import { createMMKV } from "react-native-mmkv";

import { SmokeCard, useSmoke } from "../smoke-card";

const KEY = "capabilities-smoke";

/** Writes, reads back and removes one key in a dedicated MMKV instance. */
export function MmkvSmoke() {
  const result = useSmoke(() => {
    const storage = createMMKV({ id: "apex-capabilities-smoke" });
    const written = `ok-${Date.now()}`;
    storage.set(KEY, written);
    const read = storage.getString(KEY);
    storage.remove(KEY);
    if (read !== written) throw new Error(`wrote ${written}, read ${String(read)}`);
    return `set/get/remove round-trip (${storage.id})`;
  });
  return <SmokeCard id="mmkv" title="MMKV" result={result} />;
}

/** Runs a query in an in-memory database. */
export function SqliteSmoke() {
  const result = useSmoke(() => {
    const db = openDatabaseSync(":memory:");
    try {
      db.execSync("CREATE TABLE t (n INTEGER); INSERT INTO t VALUES (20), (22);");
      const row = db.getFirstSync<{ total: number; version: string }>(
        "SELECT SUM(n) AS total, sqlite_version() AS version FROM t",
      );
      if (row?.total !== 42) throw new Error(`expected 42, got ${String(row?.total)}`);
      return `in-memory query = ${row.total} · SQLite ${row.version}`;
    } finally {
      db.closeSync();
    }
  });
  return <SmokeCard id="sqlite" title="SQLite" result={result} />;
}
