import type { ReactNode } from "react";
import { Text, View, type ViewProps } from "react-native";

import { fonts, space, useTheme } from "./theme";

function CardRoot({ children, style, ...props }: ViewProps & { children: ReactNode }) {
  const theme = useTheme();
  return (
    <View
      {...props}
      style={[
        {
          gap: space.xs,
          padding: space.md,
          borderRadius: 16,
          borderCurve: "continuous",
          backgroundColor: theme.surface,
          borderWidth: 1,
          borderColor: theme.border,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

function CardHeader({ children }: { children: ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>{children}</View>
  );
}

function CardTitle({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <Text
      maxFontSizeMultiplier={1.6}
      style={{ flexShrink: 1, fontSize: 17, fontWeight: "700", color: theme.text }}
    >
      {children}
    </Text>
  );
}

function CardBody({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return <Text style={{ fontSize: 15, lineHeight: 21, color: theme.textMuted }}>{children}</Text>;
}

function CardMeta({ children, color }: { children: ReactNode; color?: string }) {
  const theme = useTheme();
  return (
    <Text
      selectable
      maxFontSizeMultiplier={1.6}
      style={{ fontFamily: fonts.mono, fontSize: 12, color: color ?? theme.textFaint }}
    >
      {children}
    </Text>
  );
}

export const Card = Object.assign(CardRoot, {
  Header: CardHeader,
  Title: CardTitle,
  Body: CardBody,
  Meta: CardMeta,
});
