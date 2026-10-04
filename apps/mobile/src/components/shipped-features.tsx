import { Link } from "expo-router";
import { Pressable, Text, View } from "react-native";

import { SectionLabel } from "@/components/section-label";
import { type ShippedFeature, shippedFeatures } from "@/features/registry";
import { fonts, space, useTheme } from "@/theme";

function EmptyState() {
  const theme = useTheme();
  return (
    <View
      testID="shipped-empty"
      accessible
      accessibilityLabel="Nothing shipped yet. Propose the first one at the booth and watch it land right here."
      style={{
        alignItems: "center",
        gap: space.sm,
        paddingVertical: 32,
        paddingHorizontal: space.lg,
        borderWidth: 1.5,
        borderStyle: "dashed",
        borderColor: theme.border,
        borderRadius: 20,
        borderCurve: "continuous",
      }}
    >
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          borderWidth: 1.5,
          borderColor: theme.accent,
          alignItems: "center",
          justifyContent: "center",
          marginBottom: space.xs,
        }}
      >
        <Text
          allowFontScaling={false}
          style={{ fontSize: 24, lineHeight: 26, fontWeight: "300", color: theme.accentText }}
        >
          +
        </Text>
      </View>
      <Text style={{ fontSize: 17, fontWeight: "700", color: theme.text }}>
        Nothing shipped yet.
      </Text>
      <Text style={{ fontSize: 15, lineHeight: 21, textAlign: "center", color: theme.textMuted }}>
        Propose the first one at the booth and watch it land right here.
      </Text>
    </View>
  );
}

function FeatureRow({ feature }: { feature: ShippedFeature }) {
  const theme = useTheme();
  const meta = `#${feature.issue} · ${feature.shippedAt}`;
  const body = (
    <View
      testID={feature.href ? undefined : `shipped-feature-${feature.id}`}
      accessible={!feature.href}
      accessibilityLabel={`${feature.title}. ${feature.summary}. ${meta}`}
      style={{
        gap: space.xs,
        padding: space.md,
        borderRadius: 16,
        borderCurve: "continuous",
        backgroundColor: theme.surface,
        borderWidth: 1,
        borderColor: theme.border,
      }}
    >
      <Text style={{ fontSize: 17, fontWeight: "700", color: theme.text }}>{feature.title}</Text>
      <Text style={{ fontSize: 15, lineHeight: 21, color: theme.textMuted }}>
        {feature.summary}
      </Text>
      <Text selectable style={{ fontFamily: fonts.mono, fontSize: 12, color: theme.textFaint }}>
        {meta}
      </Text>
    </View>
  );

  if (!feature.href) return body;
  return (
    <Link href={feature.href} asChild>
      <Pressable
        testID={`shipped-feature-${feature.id}`}
        accessibilityRole="button"
        accessibilityLabel={`${feature.title}. ${feature.summary}. ${meta}`}
        accessibilityHint={`Opens ${feature.title}`}
        style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
      >
        {body}
      </Pressable>
    </Link>
  );
}

type Props = {
  /** Defaults to the registry; injectable for tests and previews. */
  features?: readonly ShippedFeature[];
};

/** "Shipped at the booth": every feature delivered so far, newest first. */
export function ShippedFeatures({ features = shippedFeatures }: Props) {
  const theme = useTheme();
  const newestFirst = [...features].reverse();

  return (
    <View testID="shipped-features" style={{ gap: space.md }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        <SectionLabel>Shipped at the booth</SectionLabel>
        <View
          testID="shipped-count"
          accessible
          accessibilityLabel={`${features.length} shipped`}
          style={{
            paddingHorizontal: 8,
            paddingVertical: 2,
            borderRadius: 999,
            backgroundColor: features.length > 0 ? theme.accent : theme.surface,
            borderWidth: 1,
            borderColor: features.length > 0 ? theme.accent : theme.border,
          }}
        >
          <Text
            maxFontSizeMultiplier={1.6}
            style={{
              fontFamily: fonts.mono,
              fontSize: 12,
              fontVariant: ["tabular-nums"],
              color: features.length > 0 ? theme.onAccent : theme.textMuted,
            }}
          >
            {features.length}
          </Text>
        </View>
      </View>

      {newestFirst.length === 0 ? (
        <EmptyState />
      ) : (
        <View style={{ gap: space.sm }}>
          {newestFirst.map((feature) => (
            <FeatureRow key={feature.id} feature={feature} />
          ))}
        </View>
      )}
    </View>
  );
}
