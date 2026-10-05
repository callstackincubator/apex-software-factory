// Jest picks this up automatically (a node module mock next to node_modules):
// the package's own Jest mock, since the real one needs its native module.
module.exports = require("react-native-keyboard-controller/jest");
