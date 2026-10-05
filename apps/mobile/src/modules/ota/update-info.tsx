import { useState } from "react";
import { Text } from "react-native";

import { fonts, useTheme } from "@/modules/ui";
import { getUpdater } from "@/modules/updater";

/** UUIDv7 ids share their leading (timestamp) digits; keep both ends. */
function shortId(id: string): string {
  return id.length > 13 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

export function UpdateInfo() {
  const theme = useTheme();
  // Read once: a new bundle only runs after a reload, which remounts this.
  const [bundle] = useState(() => getUpdater().runningBundle());
  const text = bundle.embedded
    ? `embedded · ${bundle.channel}`
    : `ota ${shortId(bundle.id)} · ${bundle.channel}`;
  const label = bundle.embedded
    ? `Embedded bundle, channel ${bundle.channel}`
    : `Over-the-air bundle ${bundle.id}, channel ${bundle.channel}`;

  return (
    <Text
      testID="status-bundle"
      selectable
      accessibilityLabel={label}
      maxFontSizeMultiplier={1.6}
      style={{ fontFamily: fonts.mono, fontSize: 12, color: theme.text }}
    >
      {text}
    </Text>
  );
}
