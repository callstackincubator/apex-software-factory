import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Card, space, useTheme } from "@/modules/ui";

const PROMPT = "Tap Flip to toss the coin.";

type Props = {
  random?: () => number;
};

export function CoinFlipScreen(_props: Props) {
  // Nothing tosses yet: the button has no onPress and the screen keeps no count.
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{
        flex: 1,
        gap: space.xl,
        justifyContent: "center",
        backgroundColor: theme.background,
        paddingTop: insets.top + space.lg,
        paddingBottom: insets.bottom + space.lg,
        paddingLeft: insets.left + space.lg,
        paddingRight: insets.right + space.lg,
      }}
    >
      <Card>
        <Card.Title>Coin flip</Card.Title>
        <Text
          testID="coin-result"
          accessibilityLabel={PROMPT}
          maxFontSizeMultiplier={1.6}
          style={{ fontSize: 28, fontWeight: "700", color: theme.text }}
        >
          {PROMPT}
        </Text>
      </Card>
      <Pressable
        testID="coin-flip-button"
        accessibilityRole="button"
        accessibilityLabel="Flip the coin"
        accessibilityHint="Tosses the coin and shows Heads or Tails"
        style={{
          alignItems: "center",
          paddingVertical: space.md,
          borderRadius: 16,
          borderCurve: "continuous",
          backgroundColor: theme.accent,
        }}
      >
        <Text style={{ fontSize: 19, fontWeight: "800", color: theme.onAccent }}>Flip</Text>
      </Pressable>
    </View>
  );
}
