import { Text } from "react-native";

import { fonts, useTheme } from "@/theme";

/**
 * Which JS bundle is running. Placeholder until the OTA stage wires in
 * hot-updater (ADR 0003): it should then show the running bundle id and
 * keep "embedded bundle" for the one shipped inside the binary.
 */
export function UpdateInfo() {
  const theme = useTheme();
  return (
    <Text selectable style={{ fontFamily: fonts.mono, fontSize: 12, color: theme.text }}>
      embedded bundle
    </Text>
  );
}
