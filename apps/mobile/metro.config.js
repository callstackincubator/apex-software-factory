// Metro config: Expo's defaults, plus Rozenite (debug tooling) when Metro is
// started with WITH_ROZENITE=true, plus appduct's bundle-time switch.
//
// - Rozenite is off unless WITH_ROZENITE=true (`start:agent`). Off, the config
//   is Expo's untouched and the plugins' Metro parts are never loaded; release
//   and OTA bundles never set it.
// - appduct ships in every build (APPDUCT_ENABLED=1, one build profile for the
//   booth binary, its fingerprint and OTA bundles). `withAppduct` only acts
//   when APPDUCT_ENABLED=0: it then swaps appduct's JS for its no-op entry.
//   It wraps last because it chains `resolver.resolveRequest`.
const { getDefaultConfig } = require("expo/metro-config");
const { withAppduct } = require("@appduct/react-native/metro");
const { withRozenite } = require("@rozenite/metro");

const rozenite = withRozenite(getDefaultConfig(__dirname), {
  enabled: process.env.WITH_ROZENITE === "true",
  enhanceMetroConfig: async (config) => {
    const { withRozeniteRequireProfiler } = require("@rozenite/require-profiler-plugin/metro");
    const { withRozeniteExpoAtlasPlugin } = require("@rozenite/expo-atlas-plugin");
    return withRozeniteExpoAtlasPlugin(await withRozeniteRequireProfiler(config));
  },
});

module.exports = async () => withAppduct(await rozenite());
