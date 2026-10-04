// Composes the React Native resolver from the jest-expo preset with the one
// Reanimated 4 asks for (react-native-worklets/jest/resolver.js): inside
// react-native-worklets, skip `.native.*` files so its JS implementation runs.
//
// The upstream resolver matches "react-native-worklets" anywhere in the path,
// which under pnpm also hits packages whose virtual-store directory name
// mentions it as a peer (e.g. `.pnpm/expo-modules-core@…_react-native-worklets@…`)
// and breaks them. Match the real package directory instead.
const presetResolver = require(require("jest-expo/jest-preset").resolver);

const WORKLETS = /(^|[\\/])node_modules[\\/]react-native-worklets([\\/]|$)/;

module.exports = (request, options) => {
  const inWorklets = WORKLETS.test(options.basedir) || /^react-native-worklets(\/|$)/.test(request);
  if (!inWorklets) return presetResolver(request, options);
  return presetResolver(request, {
    ...options,
    extensions: options.extensions?.filter((ext) => !ext.includes("native")),
  });
};
