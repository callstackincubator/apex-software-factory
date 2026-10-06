import { createMMKV } from "react-native-mmkv";

import { SmokeCard, useSmoke } from "../smoke-card";

const KEY = "capabilities-smoke";

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
