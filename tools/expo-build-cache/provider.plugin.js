// Expo build cache provider for `expo run:[ios|android]` (simulator and emulator builds), backed
// by the booth's native build cache in lib.js. Wired in apps/mobile/app.json:
//
//   "buildCacheProvider": { "plugin": "../../tools/expo-build-cache/provider.plugin.js" }
//
// The key is hot-updater's OTA fingerprint (calculateFingerprintHash), not Expo's default
// fingerprint, so a cached binary is exactly the one an OTA bundle for that hash targets. A
// Release hit comes back with this checkout's JS already in it (Expo itself would install the
// cached binary's old JS). .agents/scripts/device-lane.sh uses the same module through cli.js.
"use strict";

const lib = require("./lib.js");

module.exports = {
  async calculateFingerprintHash({ projectRoot, platform }) {
    return lib.fingerprint(projectRoot, platform);
  },

  async resolveBuildCache({ projectRoot, platform, fingerprintHash, runOptions }) {
    const profile = lib.profileOf(platform, runOptions);
    const binary = lib.resolve({ projectRoot, platform, fingerprint: fingerprintHash, profile });
    console.log(
      binary
        ? `build cache: hit ${platform} ${profile} ${fingerprintHash.slice(0, 8)} -> ${binary}`
        : `build cache: miss ${platform} ${profile} ${fingerprintHash.slice(0, 8)}`,
    );
    return binary;
  },

  async uploadBuildCache({ platform, fingerprintHash, buildPath, runOptions }) {
    const profile = lib.profileOf(platform, runOptions);
    const dir = lib.store({
      platform,
      fingerprint: fingerprintHash,
      profile,
      buildPath,
      meta: { by: "expo run" },
    });
    console.log(
      `build cache: stored ${platform} ${profile} ${fingerprintHash.slice(0, 8)} in ${dir}`,
    );
    return dir;
  },
};
