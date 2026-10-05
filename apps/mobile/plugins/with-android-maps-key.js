// Google Maps API key for react-native-maps on Android, read from the
// environment at prebuild time: GOOGLE_MAPS_ANDROID_API_KEY.
//
// iOS uses Apple Maps (no key). Android's map is Google Maps, which needs a
// key in the manifest. Without that meta-data entry at all, the Maps SDK
// throws "API key not found" and the app crashes the moment a <MapView>
// mounts; with an invalid key it only shows an empty grid. So a build without
// the variable gets a placeholder: it builds, nothing crashes, and Android maps
// stay blank until a binary is built with a real key (restricted to the
// package name and signing certificate in Google Cloud). The key is a build
// input like the EXPO_PUBLIC_* URLs; never commit it.
//
// List it BEFORE "react-native-maps" in app.json (Expo runs the mods of earlier
// plugins last; react-native-maps removes the entry when it has no key). See
// docs/internal/NATIVE-CAPABILITIES.md.
const { AndroidConfig, withAndroidManifest } = require("expo/config-plugins");

const META_DATA = "com.google.android.geo.API_KEY";
const PLACEHOLDER = "maps-key-not-configured";

module.exports = function withAndroidMapsKey(config) {
  return withAndroidManifest(config, (mod) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults);
    const key = process.env.GOOGLE_MAPS_ANDROID_API_KEY?.trim() || PLACEHOLDER;
    AndroidConfig.Manifest.addMetaDataItemToMainApplication(app, META_DATA, key);
    return mod;
  });
};
