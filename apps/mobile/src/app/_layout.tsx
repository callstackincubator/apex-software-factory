// Listens for appduct's pairing link and resumes a session after a reload.
import "@appduct/react-native/auto";

import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import { StatusBar } from "expo-status-bar";
import type { ReactNode } from "react";
import { useColorScheme } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { UpdateBanner } from "@/components/update-banner";
import { installAgentTools } from "@/dev/agent-tools";
import { useTrackNavigation } from "@/dev/navigation-state";
import { AppKeyboardProvider } from "@/lib/keyboard";
import { initOta } from "@/lib/ota";
import { useTheme } from "@/theme";

initOta();
installAgentTools();

// Rozenite DevTools, debug builds only. A `require` under `__DEV__` (not an
// import) lets Metro drop the module from release and OTA bundles entirely.
const DevTools: () => ReactNode = __DEV__
  ? (require("@/dev/devtools") as typeof import("@/dev/devtools")).DevTools
  : () => null;

export default function RootLayout() {
  const scheme = useColorScheme();
  const theme = useTheme();
  const base = scheme === "light" ? DefaultTheme : DarkTheme;
  useTrackNavigation();

  // Root providers for the native libraries in the binary: gestures
  // (react-native-gesture-handler) and keyboard handling
  // (react-native-keyboard-controller). Screens need not add them again.
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: theme.background }}>
      <AppKeyboardProvider>
        <ThemeProvider
          value={{
            ...base,
            colors: { ...base.colors, background: theme.background, primary: theme.accentText },
          }}
        >
          <StatusBar style={scheme === "light" ? "dark" : "light"} />
          <Stack screenOptions={{ contentStyle: { backgroundColor: theme.background } }}>
            <Stack.Screen name="index" options={{ headerShown: false, title: "Apex Factory" }} />
          </Stack>
          <UpdateBanner />
          <DevTools />
        </ThemeProvider>
      </AppKeyboardProvider>
    </GestureHandlerRootView>
  );
}
