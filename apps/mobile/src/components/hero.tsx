import { Text, View } from "react-native";

import { LiveDot } from "@/components/live-dot";
import { fonts, space, useTheme } from "@/theme";

const EVENT = "reactCon Berlin · Oct 7–9, 2026";

/** Crop marks in the four corners: the screen reads as an empty canvas. */
function CropMarks({ color }: { color: string }) {
  const arm = 18;
  const corner = { position: "absolute", width: arm, height: arm, borderColor: color } as const;
  return (
    <>
      <View style={[corner, { top: 0, left: 0, borderTopWidth: 2, borderLeftWidth: 2 }]} />
      <View style={[corner, { top: 0, right: 0, borderTopWidth: 2, borderRightWidth: 2 }]} />
      <View style={[corner, { bottom: 0, left: 0, borderBottomWidth: 2, borderLeftWidth: 2 }]} />
      <View style={[corner, { bottom: 0, right: 0, borderBottomWidth: 2, borderRightWidth: 2 }]} />
    </>
  );
}

export function Hero() {
  const theme = useTheme();

  return (
    <View style={{ gap: space.lg }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          flexWrap: "wrap",
          columnGap: space.sm,
          rowGap: space.xs,
        }}
      >
        <LiveDot color={theme.accent} />
        <Text
          maxFontSizeMultiplier={1.6}
          style={{
            fontFamily: fonts.mono,
            fontSize: 12,
            letterSpacing: 1.5,
            color: theme.text,
          }}
        >
          APEX FACTORY
        </Text>
        <Text
          maxFontSizeMultiplier={1.6}
          style={{
            marginLeft: "auto",
            fontFamily: fonts.mono,
            fontSize: 12,
            color: theme.textMuted,
          }}
        >
          {EVENT}
        </Text>
      </View>

      <View style={{ paddingVertical: 32, paddingHorizontal: space.lg }}>
        <CropMarks color={theme.accent} />
        <Text
          testID="home-headline"
          accessibilityRole="header"
          accessibilityLabel="This app is empty. On purpose."
          maxFontSizeMultiplier={1.25}
          style={{
            fontSize: 50,
            lineHeight: 52,
            fontWeight: "800",
            letterSpacing: -1.8,
            color: theme.text,
          }}
        >
          This app{"\n"}is empty.{"\n"}
          <Text style={{ color: theme.accentText }}>On purpose.</Text>
        </Text>
      </View>

      <Text style={{ fontSize: 17, lineHeight: 25, color: theme.textMuted }}>
        Every feature in here starts as an idea from someone at the{" "}
        <Text style={{ color: theme.text, fontWeight: "600" }}>Callstack booth</Text>. AI agents
        build it and ship it to this phone over the air, while you watch.
      </Text>
    </View>
  );
}
