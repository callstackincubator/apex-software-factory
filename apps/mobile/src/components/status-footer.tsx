import type { ApiClient } from "@apex/contract";
import Constants from "expo-constants";
import type { ReactNode } from "react";
import { Platform, Pressable, Text, View } from "react-native";

import { LiveDot } from "@/components/live-dot";
import { UpdateInfo } from "@/components/update-info";
import { api } from "@/lib/api";
import { type ApiHealth, useApiHealth } from "@/lib/use-api-health";
import { fonts, space, type Theme, useTheme } from "@/theme";

function Row({ label, children }: { label: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 28 }}>
      <Text
        maxFontSizeMultiplier={1.6}
        style={{ width: 56, fontFamily: fonts.mono, fontSize: 12, color: theme.textFaint }}
      >
        {label}
      </Text>
      <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: space.sm }}>
        {children}
      </View>
    </View>
  );
}

function describe(health: ApiHealth, theme: Theme) {
  switch (health.state) {
    case "ok":
      return { text: `ok · v${health.version}`, color: theme.accent };
    case "offline":
      return { text: "offline", color: theme.danger };
    case "checking":
      return { text: "checking…", color: theme.textFaint };
  }
}

/** `ios` reads "iOS" and `android` "Android"; any other value is shown as it is. */
function platformName(os: string) {
  switch (os) {
    case "ios":
      return "iOS";
    case "android":
      return "Android";
    default:
      return os;
  }
}

type Props = {
  /** Defaults to the app's API client; injectable for tests. */
  client?: Pick<ApiClient, "health">;
};

/** API health, app version and platform, running bundle — what a booth demo needs at a glance. */
export function StatusFooter({ client = api }: Props) {
  const theme = useTheme();
  const { health, refresh } = useApiHealth(client);
  const status = describe(health, theme);
  const appVersion = Constants.expoConfig?.version ?? "unknown";
  const platform = platformName(Platform.OS);

  return (
    <View
      style={{
        gap: space.xs,
        paddingTop: space.md,
        borderTopWidth: 1,
        borderTopColor: theme.border,
      }}
    >
      <Pressable
        testID="status-api"
        onPress={refresh}
        accessibilityRole="button"
        accessibilityLabel={`API status: ${status.text}`}
        accessibilityHint="Checks the API again"
        style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
      >
        <Row label="API">
          <LiveDot color={status.color} size={7} pulse={health.state === "ok"} />
          <Text
            selectable
            maxFontSizeMultiplier={1.6}
            style={{ fontFamily: fonts.mono, fontSize: 12, color: theme.text }}
          >
            {status.text}
          </Text>
        </Row>
      </Pressable>
      <View
        testID="status-app"
        accessible
        accessibilityLabel={`App version ${appVersion} on ${platform}`}
      >
        <Row label="App">
          <Text
            selectable
            maxFontSizeMultiplier={1.6}
            style={{ fontFamily: fonts.mono, fontSize: 12, color: theme.text }}
          >
            {`v${appVersion} · ${platform}`}
          </Text>
        </Row>
      </View>
      <Row label="Bundle">
        <UpdateInfo />
      </Row>
    </View>
  );
}
