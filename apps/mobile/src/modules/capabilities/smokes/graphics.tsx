import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { Text, View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";

import { type SmokeResult, SmokeCard, useRenderSmoke } from "../smoke-card";

export function SvgSmoke() {
  const [result, setResult] = useRenderSmoke("Svg");
  return (
    <SmokeCard id="svg" title="SVG" result={result}>
      <Svg
        testID="svg-view"
        width={64}
        height={64}
        viewBox="0 0 64 64"
        accessibilityLabel="SVG circle with a check mark"
        onLayout={() => setResult({ status: "ok", detail: "Svg view rendered" })}
      >
        <Circle cx={32} cy={32} r={28} fill="#C6F432" />
        <Path d="M20 33 l8 8 l16 -18" stroke="#0A0A0C" strokeWidth={5} fill="none" />
      </Svg>
    </SmokeCard>
  );
}

function combine(gradient: SmokeResult, blur: SmokeResult): SmokeResult {
  if (gradient.status === "failed" || blur.status === "failed") {
    return { status: "failed", detail: `${gradient.detail}; ${blur.detail}` };
  }
  if (gradient.status === "ok" && blur.status === "ok") {
    return { status: "ok", detail: "LinearGradient and BlurView rendered" };
  }
  return { status: "pending", detail: "rendering…" };
}

export function GradientBlurSmoke() {
  const [gradient, setGradient] = useRenderSmoke("LinearGradient");
  const [blur, setBlur] = useRenderSmoke("BlurView");
  return (
    <SmokeCard id="gradient-blur" title="Linear gradient + blur" result={combine(gradient, blur)}>
      <View style={{ height: 64, borderRadius: 8, overflow: "hidden" }}>
        <LinearGradient
          testID="gradient-view"
          colors={["#C6F432", "#2E7DFF", "#FF6B5B"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ flex: 1, justifyContent: "center", paddingHorizontal: 12 }}
          onLayout={() => setGradient({ status: "ok", detail: "gradient" })}
        >
          <Text style={{ fontWeight: "800", fontSize: 22, color: "#0A0A0C" }}>reactCon</Text>
        </LinearGradient>
        <BlurView
          testID="blur-view"
          intensity={40}
          tint="dark"
          style={{ position: "absolute", top: 0, bottom: 0, right: 0, width: "50%" }}
          onLayout={() => setBlur({ status: "ok", detail: "blur" })}
        />
      </View>
    </SmokeCard>
  );
}
