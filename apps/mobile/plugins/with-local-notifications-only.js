// The booth binary schedules LOCAL notifications only (expo-notifications).
//
// expo-notifications' own config plugin, which Expo also applies automatically
// whenever the package is installed, adds the iOS `aps-environment`
// entitlement for push. Signing an app with that entitlement needs a
// provisioning profile with the Push Notifications capability, which a
// personal team cannot have and the booth does not use (there are no APNs or
// FCM credentials anywhere). Local notifications need no entitlement, so this
// plugin removes it again. List it BEFORE "expo-notifications" in app.json:
// Expo runs the mods of earlier plugins last, so this one gets the final word.
//
// Push notifications are not in the binary: docs/internal/NATIVE-CAPABILITIES.md.
const { withEntitlementsPlist } = require("expo/config-plugins");

module.exports = function withLocalNotificationsOnly(config) {
  return withEntitlementsPlist(config, (mod) => {
    delete mod.modResults["aps-environment"];
    return mod;
  });
};
