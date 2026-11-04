/** @type {import('@expo/fingerprint').Config} */
const config = {
  ignorePaths: ["**/react-native-maps/ios/AirMaps/RNMapsDefines.h"],
  extraSources: [{ type: "dir", filePath: "plugins", reasons: ["local-config-plugins"] }],
};

module.exports = config;
