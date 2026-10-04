// Jest picks this up automatically (a node module mock next to node_modules):
// the real package needs its native module (and its own Jest setup loads
// CanvasKit WASM). Components render as plain views; the offscreen surface
// remembers the colour drawn and reads it back, which is all the app uses.
import type { ReactNode } from "react";
import { View } from "react-native";

const Passthrough = ({ children, ...props }: { children?: ReactNode }) => (
  <View {...props}>{children}</View>
);

export const Canvas = Passthrough;
export const Rect = Passthrough;
export const Circle = Passthrough;
export const LinearGradient = Passthrough;
export const vec = (x: number, y: number) => ({ x, y });

export enum ColorType {
  RGBA_8888 = 4,
}
export enum AlphaType {
  Unpremul = 3,
}

function hexToRgba(hex: string): number[] {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}

export const Skia = {
  Color: (hex: string) => hex,
  Surface: {
    Make: (_width: number, _height: number) => {
      let color = "#000000";
      return {
        getCanvas: () => ({ drawColor: (c: string) => (color = c) }),
        flush: () => {},
        makeImageSnapshot: () => ({ readPixels: () => Uint8Array.from(hexToRgba(color)) }),
      };
    },
  },
};
