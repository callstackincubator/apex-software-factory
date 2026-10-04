import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useColorScheme, View } from "react-native";

import { UpdateBanner } from "@/components/update-banner";
import { initOta } from "@/lib/ota";
import { useTheme } from "@/theme";

initOta();

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
      <View style={{ flex: 1, backgroundColor: theme.background }}>
        <Stack screenOptions={{ contentStyle: { backgroundColor: theme.background } }}>
          <Stack.Screen name="index" options={{ headerShown: false, title: "Apex Factory" }} />
        </Stack>
        <UpdateBanner />
      </View>
    </ThemeProvider>
  );
}
