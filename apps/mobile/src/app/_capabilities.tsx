import { Stack } from "expo-router";

import { CapabilitiesScreen } from "@/modules/capabilities";

export default function CapabilitiesRoute() {
  return (
    <>
      <Stack.Screen options={{ title: "Native capabilities" }} />
      <CapabilitiesScreen />
    </>
  );
}
