// Listens for appduct's pairing link and resumes a session after a reload.
import "@appduct/react-native/auto";

import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import { StatusBar } from "expo-status-bar";
import type { ReactNode } from "react";
import { useColorScheme } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { installAgentTools, useTrackNavigation } from "@/modules/agent-tools";
import { initOta, UpdateBanner } from "@/modules/ota";
import { AppKeyboardProvider, useTheme } from "@/modules/ui";

initOta();
installAgentTools();

// A require under __DEV__, not an import, so Metro drops it from release and OTA bundles.
const DevTools: () => ReactNode = __DEV__
  ? (require("@/modules/devtools") as typeof import("@/modules/devtools")).DevTools
  : () => null;

export default function RootLayout() {
  const scheme = useColorScheme();
  const theme = useTheme();
  const base = scheme === "light" ? DefaultTheme : DarkTheme;
  useTrackNavigation();

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
