/**
 * Which native libraries the binary carries, and whether each one's native
 * side actually loads. Over-the-air updates cannot add native code, so an
 * agent planning a booth feature asks the `native_capabilities` tool (and a
 * person opens `/_capabilities`) instead of trusting `package.json`, which
 * describes the checkout, not the binary on the phone.
 *
 * The authoritative list, with permissions and platform limits, is
 * docs/internal/NATIVE-CAPABILITIES.md; keep the two in step.
 *
 * Every check is cheap and side-effect free: it asks the module registry
 * (Expo modules, TurboModules, Nitro hybrid objects) whether the module is
 * there. Nothing asks for a permission or touches the user's data.
 */
import { requireOptionalNativeModule } from "expo";
import { Platform, TurboModuleRegistry } from "react-native";

import appPackage from "../../package.json";

export type NativeModuleKind = "expo" | "turbo" | "nitro";
type NativePlatform = "ios" | "android";

export type NativeLibrary = {
  /** Stable kebab-case id, used in testIDs and by agents. */
  id: string;
  /** The npm package, as in apps/mobile/package.json. */
  package: string;
  /** What a booth feature can do with it, in a few words. */
  enables: string;
  /** Native modules that must all load: [kind, registered name]. */
  modules: readonly (readonly [NativeModuleKind, string])[];
  /** Where it has a native side; elsewhere it is reported `not-on-platform`. */
  platforms?: readonly NativePlatform[];
};

/**
 * The native libraries in the booth binary. Order: added for booth features
 * first (docs/internal/NATIVE-CAPABILITIES.md), then the base the app
 * already had.
 */
export const NATIVE_LIBRARIES: readonly NativeLibrary[] = [
  {
    id: "skia",
    package: "@shopify/react-native-skia",
    enables: "2D drawing, shaders, image filters",
    modules: [["turbo", "RNSkiaModule"]],
  },
  {
    id: "nitro-modules",
    package: "react-native-nitro-modules",
    enables: "runtime for the Nitro libraries below",
    modules: [["turbo", "NitroModules"]],
  },
  {
    id: "mmkv",
    package: "react-native-mmkv",
    enables: "fast synchronous key-value storage",
    modules: [["nitro", "MMKVFactory"]],
  },
  {
    id: "sqlite",
    package: "expo-sqlite",
    enables: "on-device SQL database",
    modules: [["expo", "ExpoSQLite"]],
  },
  {
    id: "vision-camera",
    package: "react-native-vision-camera",
    enables: "camera preview, photos, QR/barcode scanning (iOS object output)",
    modules: [["nitro", "CameraFactory"]],
  },
  {
    id: "nitro-image",
    package: "react-native-nitro-image",
    enables: "in-memory images for VisionCamera photos",
    modules: [["nitro", "ImageFactory"]],
  },
  {
    id: "barcode-scanner",
    package: "react-native-vision-camera-barcode-scanner",
    enables: "QR/barcode scanning on Android (MLKit)",
    modules: [["nitro", "BarcodeScannerFactory"]],
    platforms: ["android"],
  },
  {
    id: "notifications",
    package: "expo-notifications",
    enables: "local notifications (no push)",
    modules: [
      ["expo", "ExpoNotificationScheduler"],
      ["expo", "ExpoNotificationPermissionsModule"],
      ["expo", "ExpoNotificationPresenter"],
    ],
  },
  {
    id: "calendar",
    package: "expo-calendar",
    enables: "read and add calendar events",
    modules: [
      ["expo", "CalendarNext"],
      ["expo", "ExpoCalendar"],
    ],
  },
  {
    id: "image-picker",
    package: "expo-image-picker",
    enables: "pick a photo, or take one with the system camera",
    modules: [["expo", "ExponentImagePicker"]],
  },
  {
    id: "sharing",
    package: "expo-sharing",
    enables: "system share sheet for files",
    modules: [["expo", "ExpoSharing"]],
  },
  {
    id: "media-library",
    package: "expo-media-library",
    enables: "save images to the photo library",
    modules: [
      ["expo", "ExpoMediaLibraryNext"],
      ["expo", "ExpoMediaLibrary"],
    ],
  },
  {
    id: "maps",
    package: "react-native-maps",
    enables: "map views (Apple Maps on iOS; Google Maps on Android needs a key)",
    modules: [["turbo", "RNMapsAirModule"]],
  },
  {
    id: "location",
    package: "expo-location",
    enables: "location while the app is open",
    modules: [["expo", "ExpoLocation"]],
  },
  {
    id: "svg",
    package: "react-native-svg",
    enables: "SVG shapes and icons",
    modules: [["turbo", "RNSVGSvgViewModule"]],
  },
  {
    id: "linear-gradient",
    package: "expo-linear-gradient",
    enables: "gradient backgrounds",
    modules: [["expo", "ExpoLinearGradient"]],
  },
  {
    id: "blur",
    package: "expo-blur",
    enables: "blurred translucent views",
    modules: [["expo", "ExpoBlur"]],
  },
  {
    id: "sensors",
    package: "expo-sensors",
    enables: "accelerometer, gyroscope, magnetometer, barometer, device motion, pedometer",
    modules: [
      ["expo", "ExponentAccelerometer"],
      ["expo", "ExponentGyroscope"],
      ["expo", "ExponentMagnetometer"],
      ["expo", "ExpoBarometer"],
      ["expo", "ExponentDeviceMotion"],
      ["expo", "ExponentPedometer"],
    ],
  },
  {
    id: "keyboard-controller",
    package: "react-native-keyboard-controller",
    enables: "keyboard-aware layouts and animations",
    modules: [["turbo", "KeyboardController"]],
  },
  {
    id: "clipboard",
    package: "expo-clipboard",
    enables: "copy and paste",
    modules: [["expo", "ExpoClipboard"]],
  },
  {
    id: "speech",
    package: "expo-speech",
    enables: "text to speech",
    modules: [["expo", "ExpoSpeech"]],
  },
  {
    id: "webview",
    package: "react-native-webview",
    enables: "embedded web content",
    modules: [["turbo", "RNCWebViewModule"]],
  },
  // The base the app already had.
  {
    id: "gesture-handler",
    package: "react-native-gesture-handler",
    enables: "native gestures",
    modules: [["turbo", "RNGestureHandlerModule"]],
  },
  {
    id: "reanimated",
    package: "react-native-reanimated",
    enables: "UI-thread animations",
    modules: [["turbo", "ReanimatedModule"]],
  },
  {
    id: "worklets",
    package: "react-native-worklets",
    enables: "worklet runtime for Reanimated, Skia, keyboard-controller",
    modules: [["turbo", "WorkletsModule"]],
  },
  {
    id: "haptics",
    package: "expo-haptics",
    enables: "haptic feedback",
    modules: [["expo", "ExpoHaptics"]],
  },
  {
    id: "image",
    package: "expo-image",
    enables: "fast cached images",
    modules: [["expo", "ExpoImage"]],
  },
  {
    id: "symbols",
    package: "expo-symbols",
    enables: "SF Symbols",
    modules: [["expo", "SymbolModule"]],
    platforms: ["ios"],
  },
  {
    id: "glass-effect",
    package: "expo-glass-effect",
    enables: "Liquid Glass views",
    modules: [["expo", "ExpoGlassEffect"]],
    platforms: ["ios"],
  },
  {
    id: "expo-ui",
    package: "@expo/ui",
    enables: "SwiftUI and Jetpack Compose components",
    modules: [["expo", "ExpoUI"]],
  },
  {
    id: "web-browser",
    package: "expo-web-browser",
    enables: "in-app browser sheet",
    modules: [["expo", "ExpoWebBrowser"]],
  },
  {
    id: "device",
    package: "expo-device",
    enables: "device model and OS facts",
    modules: [["expo", "ExpoDevice"]],
  },
];

export type CapabilityStatus = "linked" | "missing" | "not-on-platform";

export type NativeCapability = {
  id: string;
  package: string;
  /** The version range in package.json when this JS bundle was built. */
  version: string | null;
  status: CapabilityStatus;
  /** Modules that did not load (empty when linked). */
  missingModules: string[];
  enables: string;
};

export type NativeCapabilityReport = {
  platform: string;
  /** True when every library with a native side on this platform loaded. */
  allLinked: boolean;
  /** Ids of the libraries that did not load. */
  missing: string[];
  libraries: NativeCapability[];
};

/** What the probe needs; injectable for tests. */
export type ProbeDeps = {
  platform: string;
  versions: Readonly<Record<string, string | undefined>>;
  /** True when the module loads; must not throw, prompt or touch data. */
  hasModule(kind: NativeModuleKind, name: string): boolean;
};

export function probeNativeCapabilities(
  deps: ProbeDeps,
  libraries: readonly NativeLibrary[] = NATIVE_LIBRARIES,
): NativeCapabilityReport {
  const results = libraries.map((library): NativeCapability => {
    const base = {
      id: library.id,
      package: library.package,
      version: deps.versions[library.package] ?? null,
      enables: library.enables,
    };
    if (library.platforms && !library.platforms.includes(deps.platform as NativePlatform)) {
      return { ...base, status: "not-on-platform", missingModules: [] };
    }
    const missingModules = library.modules
      .filter(([kind, name]) => !safely(() => deps.hasModule(kind, name)))
      .map(([kind, name]) => `${kind}:${name}`);
    return { ...base, status: missingModules.length ? "missing" : "linked", missingModules };
  });
  const missing = results.filter((r) => r.status === "missing").map((r) => r.id);
  return { platform: deps.platform, allLinked: missing.length === 0, missing, libraries: results };
}

function safely(check: () => boolean): boolean {
  try {
    return check();
  } catch {
    return false;
  }
}

type NitroProxy = { hasHybridObject(name: string): boolean };

/** The real registries. Nitro is required lazily so a binary without it reports, not crashes. */
export function defaultProbeDeps(): ProbeDeps {
  return {
    platform: Platform.OS,
    versions: appPackage.dependencies,
    hasModule(kind, name) {
      switch (kind) {
        case "expo":
          return requireOptionalNativeModule(name) != null;
        case "turbo":
          return TurboModuleRegistry.get(name) != null;
        case "nitro": {
          if (TurboModuleRegistry.get("NitroModules") == null) return false;
          const { NitroModules } = require("react-native-nitro-modules") as {
            NitroModules: NitroProxy;
          };
          return NitroModules.hasHybridObject(name);
        }
      }
    },
  };
}
