import { Text, View } from "react-native";

import { SectionLabel } from "@/components/section-label";
import { fonts, space, useTheme } from "@/theme";

const STEPS = [
  { title: "Propose", body: "Pitch a feature at the Callstack booth." },
  { title: "Spec", body: "It becomes a GitHub issue with a clear spec." },
  { title: "Build", body: "Agents implement, review and merge it." },
  { title: "Ship", body: "It lands here over the air, minutes later." },
] as const;

export function HowItWorks() {
  const theme = useTheme();

  return (
    <View style={{ gap: space.md }}>
      <SectionLabel>How it lands</SectionLabel>
      <View>
        {STEPS.map((step, index) => {
          const number = String(index + 1).padStart(2, "0");
          const last = index === STEPS.length - 1;
          return (
            <View
              key={step.title}
              testID={`how-step-${index + 1}`}
              accessible
              accessibilityLabel={`Step ${index + 1}, ${step.title}. ${step.body}`}
              style={{ flexDirection: "row", gap: space.md }}
            >
              <View style={{ alignItems: "center", width: 28 }}>
                <Text
                  maxFontSizeMultiplier={1.4}
                  style={{
                    fontFamily: fonts.mono,
                    fontSize: 13,
                    lineHeight: 24,
                    color: last ? theme.accentText : theme.textMuted,
                    fontVariant: ["tabular-nums"],
                  }}
                >
                  {number}
                </Text>
                {last ? null : (
                  <View
                    style={{ flex: 1, width: 1, backgroundColor: theme.border, marginVertical: 4 }}
                  />
                )}
              </View>
              <View style={{ flex: 1, paddingBottom: last ? 0 : space.md, gap: 2 }}>
                <Text
                  style={{ fontSize: 17, lineHeight: 24, fontWeight: "700", color: theme.text }}
                >
                  {step.title}
                </Text>
                <Text style={{ fontSize: 15, lineHeight: 21, color: theme.textMuted }}>
                  {step.body}
                </Text>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}
