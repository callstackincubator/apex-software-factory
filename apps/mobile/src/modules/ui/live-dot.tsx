import { useEffect } from "react";
import { View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

type Props = { color: string; size?: number; pulse?: boolean };

export function LiveDot({ color, size = 8, pulse = true }: Props) {
  const reducedMotion = useReducedMotion();
  const progress = useSharedValue(0);
  const animate = pulse && !reducedMotion;

  useEffect(() => {
    if (!animate) return;
    progress.set(
      withRepeat(withTiming(1, { duration: 1800, easing: Easing.out(Easing.quad) }), -1),
    );
  }, [animate, progress]);

  const haloStyle = useAnimatedStyle(() => ({
    opacity: 0.55 * (1 - progress.get()),
    transform: [{ scale: 1 + progress.get() * 1.6 }],
  }));

  return (
    <View
      style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      {animate ? (
        <Animated.View
          style={[
            {
              position: "absolute",
              width: size,
              height: size,
              borderRadius: size / 2,
              backgroundColor: color,
            },
            haloStyle,
          ]}
        />
      ) : null}
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />
    </View>
  );
}
