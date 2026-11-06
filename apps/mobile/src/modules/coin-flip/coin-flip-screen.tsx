import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Card, fonts, space, useTheme } from "@/modules/ui";

import { type CoinSide, flip } from "./flip";

const PROMPT = "Tap Flip to toss the coin.";
const LAST_COUNT_SHOWN = 999;

type Props = {
  random?: () => number;
};

type Toss = { count: number; side: CoinSide };

function countLabel(count: number) {
  return count > LAST_COUNT_SHOWN ? `Flip ${LAST_COUNT_SHOWN}+` : `Flip ${count}`;
}

export function CoinFlipScreen({ random = Math.random }: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [toss, setToss] = useState<Toss | null>(null);

  // The count belongs to this visit only, so every arrival starts from the prompt.
  useFocusEffect(
    useCallback(() => {
      setToss(null);
    }, []),
  );

  const tossTheCoin = () => {
    const side = flip(random);
    setToss((current) => ({ count: (current?.count ?? 0) + 1, side }));
  };

  const result = toss?.side ?? PROMPT;

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
        <Text
          testID="coin-result"
          accessibilityLabel={result}
          maxFontSizeMultiplier={1.6}
          style={{ fontSize: 32, lineHeight: 40, fontWeight: "800", color: theme.text }}
        >
          {result}
        </Text>
        {toss ? (
          <Text
            testID="coin-count"
            accessibilityLabel={countLabel(toss.count)}
            maxFontSizeMultiplier={1.6}
            style={{
              fontFamily: fonts.mono,
              fontSize: 14,
              fontVariant: ["tabular-nums"],
              color: theme.textMuted,
            }}
          >
            {countLabel(toss.count)}
          </Text>
        ) : null}
      </Card>

      <Pressable
        testID="coin-flip-button"
        accessibilityRole="button"
        accessibilityLabel="Flip the coin"
        accessibilityHint="Tosses the coin and shows Heads or Tails"
        onPress={tossTheCoin}
        style={({ pressed }) => [
          {
            alignItems: "center",
            paddingVertical: space.lg,
            borderRadius: 20,
            borderCurve: "continuous",
            backgroundColor: theme.accent,
            opacity: pressed ? 0.7 : 1,
          },
        ]}
      >
        <Text
          maxFontSizeMultiplier={1.6}
          style={{ fontSize: 21, fontWeight: "800", textAlign: "center", color: theme.onAccent }}
        >
          Flip
        </Text>
      </Pressable>
    </View>
  );
}
