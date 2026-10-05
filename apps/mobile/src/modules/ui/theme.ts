import { useColorScheme } from "react-native";

const palette = {
  dark: {
    background: "#0A0A0C",
    surface: "#141417",
    border: "#26262B",
    text: "#F4F4EE",
    textMuted: "#9A9AA2",
    textFaint: "#5E5E66",
    accent: "#C6F432",
    accentText: "#C6F432",
    onAccent: "#0A0A0C",
    danger: "#FF6B5B",
  },
  light: {
    background: "#F6F6F1",
    surface: "#FFFFFF",
    border: "#DEDED6",
    text: "#0A0A0C",
    textMuted: "#55555C",
    textFaint: "#8C8C93",
    accent: "#8DBA00",
    accentText: "#4A6B00",
    onAccent: "#0A0A0C",
    danger: "#C8321F",
  },
} as const;

export type Theme = (typeof palette)["dark"] | (typeof palette)["light"];

export function useTheme(): Theme {
  return useColorScheme() === "light" ? palette.light : palette.dark;
}

export const fonts = {
  mono: process.env.EXPO_OS === "ios" ? "Menlo" : "monospace",
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 40,
} as const;
