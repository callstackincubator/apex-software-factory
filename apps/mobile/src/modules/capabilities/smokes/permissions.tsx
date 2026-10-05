import * as Calendar from "expo-calendar";
import * as Location from "expo-location";
import * as MediaLibrary from "expo-media-library";
import * as Notifications from "expo-notifications";
import * as Sharing from "expo-sharing";
import * as Speech from "expo-speech";

import { describeError, SmokeCard, useSmoke, withTimeout } from "../smoke-card";

async function answer(label: string, ask: () => Promise<string>): Promise<string> {
  try {
    return `${label} ${await withTimeout(ask(), label)}`;
  } catch (error) {
    return `${label} failed: ${describeError(error)}`;
  }
}

// Reads, never requests, so no visitor sees a prompt. Asked one by one, so one hang names itself.
export function PermissionsSmoke() {
  const result = useSmoke(async () => {
    const answers = await Promise.all([
      answer("notifications", async () => (await Notifications.getPermissionsAsync()).status),
      // SDK 57's expo-calendar: the new API; the old *Async functions throw.
      answer("calendar", async () => (await Calendar.getCalendarPermissions()).status),
      answer("location", async () => (await Location.getForegroundPermissionsAsync()).status),
      answer(
        "photos",
        async () => (await MediaLibrary.getPermissionsAsync(false, ["photo"])).status,
      ),
      answer("share sheet", async () => ((await Sharing.isAvailableAsync()) ? "yes" : "no")),
      answer("voices", async () => String((await Speech.getAvailableVoicesAsync()).length)),
    ]);
    const failed = answers.some((text) => text.includes(" failed: "));
    return { status: failed ? "failed" : "info", detail: answers.join(" · ") };
  });
  return <SmokeCard id="permissions" title="Permissions and services" result={result} />;
}
