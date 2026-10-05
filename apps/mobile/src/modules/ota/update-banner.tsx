import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import Animated, { FadeInDown, FadeOutDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { fonts, LiveDot, space, useTheme } from "@/modules/ui";

import { useOtaUpdate } from "./use-ota-update";

export function UpdateBanner() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { ready, reload, dismiss } = useOtaUpdate();
  const [reloading, setReloading] = useState(false);

  if (!ready) return null;

  const title = ready.rollback ? "Update withdrawn" : "New feature landed";
  const action = reloading ? "Reloading…" : "Tap to reload";
  const onPress = () => {
    if (ready.preview) {
      dismiss();
      return;
    }
    setReloading(true);
    reload().catch(() => setReloading(false));
  };

  return (
    <Animated.View
      key={ready.id}
      entering={FadeInDown.duration(400)}
      exiting={FadeOutDown}
      pointerEvents="box-none"
      style={{
        position: "absolute",
        left: insets.left + space.md,
        right: insets.right + space.md,
        bottom: insets.bottom + space.md,
        alignItems: "center",
      }}
    >
      <Pressable
        testID="update-banner"
        onPress={onPress}
        disabled={reloading}
        accessibilityRole="button"
        accessibilityLabel={[title, ready.message, action].filter(Boolean).join(". ")}
        style={({ pressed }) => ({
          width: "100%",
          maxWidth: 520,
          flexDirection: "row",
          alignItems: "center",
          gap: space.md,
          paddingVertical: 12,
          paddingHorizontal: space.md,
          borderRadius: 16,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: theme.accent,
          backgroundColor: theme.surface,
          boxShadow: "0 8px 24px rgba(0, 0, 0, 0.35)",
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <LiveDot color={theme.accent} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text
            maxFontSizeMultiplier={1.4}
            style={{ fontSize: 15, fontWeight: "700", color: theme.text }}
          >
            {title}
          </Text>
          {ready.message ? (
            <Text
              numberOfLines={2}
              maxFontSizeMultiplier={1.4}
              style={{ fontSize: 13, color: theme.textMuted }}
            >
              {ready.message}
            </Text>
          ) : null}
        </View>
        <Text
          maxFontSizeMultiplier={1.4}
          style={{ fontFamily: fonts.mono, fontSize: 12, color: theme.accentText }}
        >
          {action}
        </Text>
      </Pressable>
    </Animated.View>
  );
}
