import type { ComponentType } from "react";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { fonts, SectionLabel, space, useTheme } from "@/modules/ui";

import {
  defaultProbeDeps,
  type NativeCapabilityReport,
  probeNativeCapabilities,
} from "./native-capabilities";
import { SmokeBoundary } from "./smoke-card";

type Smoke = { id: string; title: string; load: () => ComponentType };

const smokes: readonly Smoke[] = [
  {
    id: "skia",
    title: "Skia",
    load: () => (require("./smokes/skia") as typeof import("./smokes/skia")).SkiaSmoke,
  },
  {
    id: "mmkv",
    title: "MMKV",
    load: () => (require("./smokes/storage") as typeof import("./smokes/storage")).MmkvSmoke,
  },
  {
    id: "sqlite",
    title: "SQLite",
    load: () => (require("./smokes/storage") as typeof import("./smokes/storage")).SqliteSmoke,
  },
  {
    id: "svg",
    title: "SVG",
    load: () => (require("./smokes/graphics") as typeof import("./smokes/graphics")).SvgSmoke,
  },
  {
    id: "gradient-blur",
    title: "Linear gradient + blur",
    load: () =>
      (require("./smokes/graphics") as typeof import("./smokes/graphics")).GradientBlurSmoke,
  },
  {
    id: "sensors",
    title: "Sensors",
    load: () => (require("./smokes/device") as typeof import("./smokes/device")).SensorsSmoke,
  },
  {
    id: "clipboard",
    title: "Clipboard",
    load: () => (require("./smokes/device") as typeof import("./smokes/device")).ClipboardSmoke,
  },
  {
    id: "keyboard-controller",
    title: "Keyboard controller",
    load: () => (require("./smokes/device") as typeof import("./smokes/device")).KeyboardSmoke,
  },
  {
    id: "webview",
    title: "WebView",
    load: () =>
      (require("./smokes/web-and-maps") as typeof import("./smokes/web-and-maps")).WebViewSmoke,
  },
  {
    id: "maps",
    title: "Maps",
    load: () =>
      (require("./smokes/web-and-maps") as typeof import("./smokes/web-and-maps")).MapsSmoke,
  },
  {
    id: "vision-camera",
    title: "VisionCamera",
    load: () => (require("./smokes/camera") as typeof import("./smokes/camera")).CameraSmoke,
  },
  {
    id: "permissions",
    title: "Permissions and services",
    load: () =>
      (require("./smokes/permissions") as typeof import("./smokes/permissions")).PermissionsSmoke,
  },
];

type Props = {
  probe?: () => NativeCapabilityReport;
};

export function CapabilitiesScreen({
  probe = () => probeNativeCapabilities(defaultProbeDeps()),
}: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const report = probe();
  const present = report.libraries.filter((lib) => lib.status !== "not-on-platform");
  const linked = present.filter((lib) => lib.status === "linked").length;
  const summary = `${linked} of ${present.length} native libraries linked on ${report.platform}`;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.background }}
      contentContainerStyle={{
        gap: space.md,
        paddingTop: space.md,
        paddingBottom: insets.bottom + space.lg,
        paddingLeft: insets.left + space.md,
        paddingRight: insets.right + space.md,
      }}
    >
      <View
        testID="capabilities-summary"
        accessible
        accessibilityLabel={
          report.allLinked ? summary : `${summary}. Missing: ${report.missing.join(", ")}`
        }
        style={{ gap: space.xs }}
      >
        <Text
          maxFontSizeMultiplier={1.6}
          style={{
            fontSize: 20,
            fontWeight: "700",
            color: report.allLinked ? theme.accentText : theme.danger,
          }}
        >
          {summary}
        </Text>
        {!report.allLinked && (
          <Text selectable style={{ fontFamily: fonts.mono, fontSize: 12, color: theme.danger }}>
            missing: {report.missing.join(", ")}
          </Text>
        )}
      </View>

      <SectionLabel>Linked</SectionLabel>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs }}>
        {report.libraries.map((lib) => {
          const color =
            lib.status === "linked"
              ? theme.accentText
              : lib.status === "missing"
                ? theme.danger
                : theme.textFaint;
          return (
            <Text
              key={lib.id}
              testID={`capability-${lib.id}`}
              accessibilityLabel={`${lib.package}: ${lib.status}`}
              maxFontSizeMultiplier={1.4}
              style={{
                fontFamily: fonts.mono,
                fontSize: 11,
                color,
                borderWidth: 1,
                borderColor: theme.border,
                borderRadius: 6,
                paddingHorizontal: 6,
                paddingVertical: 2,
                opacity: lib.status === "not-on-platform" ? 0.6 : 1,
              }}
            >
              {lib.status === "linked" ? "✓" : lib.status === "missing" ? "✕" : "–"} {lib.id}
            </Text>
          );
        })}
      </View>

      <SectionLabel>Live smokes</SectionLabel>
      {smokes.map((smoke) => (
        <SmokeBoundary key={smoke.id} id={smoke.id} title={smoke.title} load={smoke.load} />
      ))}
    </ScrollView>
  );
}
