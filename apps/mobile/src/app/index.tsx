import { ScrollView, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Hero } from "@/components/hero";
import { HowItWorks } from "@/components/how-it-works";
import { ShippedFeatures } from "@/components/shipped-features";
import { StatusFooter } from "@/components/status-footer";
import { space, useTheme } from "@/theme";

const enter = (index: number) => FadeInDown.duration(500).delay(80 + index * 90);

export default function HomeScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <ScrollView
        style={{ flex: 1 }}
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={{
          flexGrow: 1,
          paddingTop: insets.top + space.md,
          paddingBottom: insets.bottom + space.md,
          paddingLeft: insets.left + space.lg,
          paddingRight: insets.right + space.lg,
        }}
      >
        <View
          style={{ flexGrow: 1, gap: space.xl, width: "100%", maxWidth: 640, alignSelf: "center" }}
        >
          <Animated.View entering={enter(0)}>
            <Hero />
          </Animated.View>
          <Animated.View entering={enter(1)}>
            <ShippedFeatures />
          </Animated.View>
          <Animated.View entering={enter(2)}>
            <HowItWorks />
          </Animated.View>
          <Animated.View entering={enter(3)} style={{ marginTop: "auto" }}>
            <StatusFooter />
          </Animated.View>
        </View>
      </ScrollView>
      {/* Keeps scrolled content from running under the status bar. */}
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: insets.top,
          backgroundColor: theme.background,
          opacity: 0.94,
        }}
      />
    </View>
  );
}
