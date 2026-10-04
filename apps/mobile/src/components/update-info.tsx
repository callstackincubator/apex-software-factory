import { HotUpdater } from "@hot-updater/react-native";
import { useState } from "react";
import { Text } from "react-native";

import { fonts, useTheme } from "@/theme";

type RunningBundle = { id: string; embedded: boolean; channel: string };

function readRunningBundle(): RunningBundle {
  const id = HotUpdater.getBundleId();
  // Without an OTA bundle the native side reports the binary's build-time id.
  return { id, embedded: id === HotUpdater.getMinBundleId(), channel: HotUpdater.getChannel() };
}

/** UUIDv7 ids share their leading (timestamp) digits; keep both ends. */
function shortId(id: string): string {
  return id.length > 13 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

/**
 * Which JS bundle is running: "embedded" for the one shipped inside the
 * binary, or the OTA bundle id, plus the update channel. Read once per JS
 * runtime — a new bundle only runs after a reload, which remounts this.
 */
export function UpdateInfo() {
  const theme = useTheme();
  const [bundle] = useState(readRunningBundle);
  const text = bundle.embedded
    ? `embedded · ${bundle.channel}`
    : `ota ${shortId(bundle.id)} · ${bundle.channel}`;
  const label = bundle.embedded
    ? `Embedded bundle, channel ${bundle.channel}`
    : `Over-the-air bundle ${bundle.id}, channel ${bundle.channel}`;

  return (
    <Text
      selectable
      accessibilityLabel={label}
      maxFontSizeMultiplier={1.6}
      style={{ fontFamily: fonts.mono, fontSize: 12, color: theme.text }}
    >
      {text}
    </Text>
  );
}
