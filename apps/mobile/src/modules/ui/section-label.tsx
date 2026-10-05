import { Text } from "react-native";

import { fonts, useTheme } from "./theme";

export function SectionLabel({ children }: { children: string }) {
  const theme = useTheme();
  return (
    <Text
      accessibilityRole="header"
      maxFontSizeMultiplier={1.6}
      style={{
        fontFamily: fonts.mono,
        fontSize: 12,
        letterSpacing: 1.5,
        textTransform: "uppercase",
        color: theme.textMuted,
      }}
    >
      {children}
    </Text>
  );
}
