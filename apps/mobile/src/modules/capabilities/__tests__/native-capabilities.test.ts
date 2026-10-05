import appPackage from "../../../../package.json";
import {
  NATIVE_LIBRARIES,
  type NativeLibrary,
  type ProbeDeps,
  probeNativeCapabilities,
} from "../native-capabilities";

const libraries: NativeLibrary[] = [
  {
    id: "skia",
    package: "@shopify/react-native-skia",
    enables: "drawing",
    modules: [["turbo", "RNSkiaModule"]],
  },
  {
    id: "sensors",
    package: "expo-sensors",
    enables: "sensors",
    modules: [
      ["expo", "ExponentAccelerometer"],
      ["expo", "ExpoBarometer"],
    ],
  },
  {
    id: "barcode-scanner",
    package: "react-native-vision-camera-barcode-scanner",
    enables: "QR on Android",
    modules: [["nitro", "BarcodeScannerFactory"]],
    platforms: ["android"],
  },
];

function deps(loaded: string[], overrides: Partial<ProbeDeps> = {}): ProbeDeps {
  return {
    platform: "ios",
    versions: { "@shopify/react-native-skia": "2.6.2", "expo-sensors": "~57.0.3" },
    hasModule: jest.fn((kind, name) => loaded.includes(`${kind}:${name}`)),
    ...overrides,
  };
}

describe("probeNativeCapabilities", () => {
  it("reports every library linked when all of its modules load", () => {
    const report = probeNativeCapabilities(
      deps(["turbo:RNSkiaModule", "expo:ExponentAccelerometer", "expo:ExpoBarometer"]),
      libraries,
    );

    expect(report).toEqual({
      platform: "ios",
      allLinked: true,
      missing: [],
      libraries: [
        {
          id: "skia",
          package: "@shopify/react-native-skia",
          version: "2.6.2",
          status: "linked",
          missingModules: [],
          enables: "drawing",
        },
        {
          id: "sensors",
          package: "expo-sensors",
          version: "~57.0.3",
          status: "linked",
          missingModules: [],
          enables: "sensors",
        },
        {
          id: "barcode-scanner",
          package: "react-native-vision-camera-barcode-scanner",
          version: null,
          status: "not-on-platform",
          missingModules: [],
          enables: "QR on Android",
        },
      ],
    });
  });

  it("names a library missing when one of its modules does not load, and which one", () => {
    const report = probeNativeCapabilities(
      deps(["turbo:RNSkiaModule", "expo:ExponentAccelerometer"]),
      libraries,
    );

    expect(report.allLinked).toBe(false);
    expect(report.missing).toEqual(["sensors"]);
    expect(report.libraries[1]).toMatchObject({
      status: "missing",
      missingModules: ["expo:ExpoBarometer"],
    });
  });

  it("reads a check that throws as missing instead of failing the whole report", () => {
    const hasModule = jest.fn((kind: string) => {
      if (kind === "nitro") throw new Error("NitroModules are not installed");
      return true;
    });

    const report = probeNativeCapabilities(deps([], { platform: "android", hasModule }), libraries);

    expect(report.missing).toEqual(["barcode-scanner"]);
    expect(report.libraries[2]).toMatchObject({
      status: "missing",
      missingModules: ["nitro:BarcodeScannerFactory"],
    });
  });

  it("does not check the modules of a library this platform does not carry", () => {
    const probe = deps(["turbo:RNSkiaModule", "expo:ExponentAccelerometer", "expo:ExpoBarometer"]);

    probeNativeCapabilities(probe, libraries);

    expect(probe.hasModule).not.toHaveBeenCalledWith("nitro", "BarcodeScannerFactory");
  });
});

describe("NATIVE_LIBRARIES", () => {
  it("lists only direct dependencies of the app, once each, with stable kebab-case ids", () => {
    const dependencies: Record<string, string> = appPackage.dependencies;
    const ids = NATIVE_LIBRARIES.map((lib) => lib.id);

    expect(new Set(ids).size).toBe(ids.length);
    for (const lib of NATIVE_LIBRARIES) {
      expect(lib.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(dependencies[lib.package]).toBeDefined();
      expect(lib.modules.length).toBeGreaterThan(0);
    }
  });

  it("covers every native library the booth binary bundles for visitors' features", () => {
    const listed = new Set(NATIVE_LIBRARIES.map((lib) => lib.package));

    // docs/internal/NATIVE-CAPABILITIES.md: the maintainer-approved set.
    for (const pkg of [
      "@shopify/react-native-skia",
      "react-native-mmkv",
      "react-native-nitro-modules",
      "expo-sqlite",
      "react-native-vision-camera",
      "expo-notifications",
      "expo-calendar",
      "expo-image-picker",
      "expo-sharing",
      "expo-media-library",
      "react-native-maps",
      "expo-location",
      "react-native-svg",
      "expo-linear-gradient",
      "expo-blur",
      "expo-sensors",
      "react-native-keyboard-controller",
      "expo-clipboard",
      "expo-speech",
      "react-native-webview",
    ]) {
      expect(listed).toContain(pkg);
    }
  });
});
