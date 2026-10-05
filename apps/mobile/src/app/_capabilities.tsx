import { Stack } from "expo-router";

import { CapabilitiesScreen } from "@/dev/capabilities/capabilities-screen";

/**
 * Hidden dev route: the native libraries in this binary and a live smoke for
 * each. Not linked from the home screen; open it with appduct
 * (`open_route {"path":"/_capabilities"}`) or the deep link
 * `apexfactory:///_capabilities`.
 */
export default function CapabilitiesRoute() {
  return (
    <>
      <Stack.Screen options={{ title: "Native capabilities" }} />
      <CapabilitiesScreen />
    </>
  );
}
