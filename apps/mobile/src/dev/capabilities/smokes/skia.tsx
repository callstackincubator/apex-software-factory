import {
  AlphaType,
  Canvas,
  Circle,
  ColorType,
  LinearGradient,
  Rect,
  Skia,
  vec,
} from "@shopify/react-native-skia";

import { SmokeCard, useSmoke } from "../smoke-card";

const PROBE = { r: 198, g: 244, b: 50 }; // #C6F432, the booth accent

/** Draws offscreen and reads the pixel back (proves the renderer), then shows a live canvas. */
export function SkiaSmoke() {
  const result = useSmoke(() => {
    const surface = Skia.Surface.Make(4, 4);
    if (!surface) throw new Error("Skia.Surface.Make returned null");
    surface.getCanvas().drawColor(Skia.Color("#C6F432"));
    surface.flush();
    const pixels = surface.makeImageSnapshot().readPixels(0, 0, {
      width: 1,
      height: 1,
      colorType: ColorType.RGBA_8888,
      alphaType: AlphaType.Unpremul,
    });
    if (!pixels) throw new Error("readPixels returned null");
    const [r = -1, g = -1, b = -1] = Array.from(pixels);
    const close = (actual: number, expected: number) => Math.abs(actual - expected) <= 2;
    if (!close(r, PROBE.r) || !close(g, PROBE.g) || !close(b, PROBE.b)) {
      throw new Error(`drew #C6F432, read back rgb(${r}, ${g}, ${b})`);
    }
    return `offscreen draw + readPixels rgb(${r}, ${g}, ${b})`;
  });

  return (
    <SmokeCard id="skia" title="Skia" result={result}>
      <Canvas
        testID="skia-canvas"
        style={{ height: 64 }}
        accessibilityLabel="Skia canvas: gradient and circle"
      >
        <Rect x={0} y={0} width={400} height={64}>
          <LinearGradient start={vec(0, 0)} end={vec(400, 0)} colors={["#C6F432", "#2E7DFF"]} />
        </Rect>
        <Circle cx={32} cy={32} r={20} color="#0A0A0C" />
      </Canvas>
    </SmokeCard>
  );
}
