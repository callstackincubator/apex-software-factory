import * as Calendar from "expo-calendar";
import * as Location from "expo-location";
import * as MediaLibrary from "expo-media-library";
import * as Notifications from "expo-notifications";
import * as Sharing from "expo-sharing";
import * as Speech from "expo-speech";

import { SmokeCard, useSmoke } from "../smoke-card";

/**
 * Reads, never requests, the permissions the booth binary declares, plus
 * share-sheet and voice availability: each module answers without putting a
 * prompt in front of a visitor.
 */
export function PermissionsSmoke() {
  const result = useSmoke(async () => {
    const [notifications, calendar, location, photos, sharing, voices] = await Promise.all([
      Notifications.getPermissionsAsync(),
      Calendar.getCalendarPermissionsAsync(),
      Location.getForegroundPermissionsAsync(),
      MediaLibrary.getPermissionsAsync(false, ["photo"]),
      Sharing.isAvailableAsync(),
      Speech.getAvailableVoicesAsync(),
    ]);
    return {
      status: "info",
      detail: [
        `notifications ${notifications.status}`,
        `calendar ${calendar.status}`,
        `location ${location.status}`,
        `photos ${photos.status}`,
        `share sheet ${sharing ? "yes" : "no"}`,
        `${voices.length} voices`,
      ].join(" · "),
    };
  });
  return <SmokeCard id="permissions" title="Permissions and services" result={result} />;
}
