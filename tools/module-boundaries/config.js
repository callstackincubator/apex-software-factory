"use strict";

// Packages on an app's `framework` list may be imported anywhere. Any other package is a
// third-party API: only the files its `owners` globs match (paths relative to `src`) may import
// it, which is the port module that wraps it. A package on neither list is a violation.
module.exports = [
  {
    name: "mobile",
    src: "apps/mobile/src",
    alias: "@/",
    framework: [
      "@apex/contract",
      "@apex/event-bus",
      "@expo/ui",
      "@shopify/react-native-skia",
      "expo",
      "expo-blur",
      "expo-constants",
      "expo-glass-effect",
      "expo-image",
      "expo-linear-gradient",
      "expo-router",
      "expo-status-bar",
      "expo-symbols",
      "react",
      "react-native",
      "react-native-gesture-handler",
      "react-native-keyboard-controller",
      "react-native-maps",
      "react-native-reanimated",
      "react-native-safe-area-context",
      "react-native-screens",
      "react-native-svg",
      "react-native-webview",
      "zod",
    ],
    owners: {
      "@hot-updater/react-native": ["modules/updater/**"],
      "@appduct/react-native": [
        "modules/agent-tools/**",
        "modules/*/agent-tools.ts",
        "app/_layout.tsx",
      ],
      "@rozenite/*": ["modules/devtools/**"],
      "*": ["modules/capabilities/**"],
    },
  },
  {
    name: "api",
    src: "apps/api/src",
    alias: null,
    framework: [
      "@apex/contract",
      "@apex/event-bus",
      "@hono/node-server",
      "@hono/zod-openapi",
      "@scalar/hono-api-reference",
      "hono",
      "node:http",
      "pino",
      "zod",
    ],
    owners: {
      "node:fs": ["config.ts"],
    },
  },
];
