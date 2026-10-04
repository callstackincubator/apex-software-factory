import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useColorScheme } from "react-native";

import { useTheme } from "@/theme";

export default function RootLayout() {
  const scheme = useColorScheme();
  const theme = useTheme();
  const base = scheme === "light" ? DefaultTheme : DarkTheme;

  return (
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
    </ThemeProvider>
  );
}
