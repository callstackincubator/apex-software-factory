import { useCameraDevices, useCameraPermission } from "react-native-vision-camera";

import { SmokeCard } from "../smoke-card";

// Never requests the permission and never opens a camera session.
export function CameraSmoke() {
  const { status } = useCameraPermission();
  const devices = useCameraDevices();
  const scanner = process.env.EXPO_OS === "ios" ? "object output" : "MLKit barcode scanner";
  return (
    <SmokeCard
      id="vision-camera"
      title="VisionCamera"
      result={{
        status: "info",
        detail: `permission ${status} · ${devices.length} camera(s) · QR via ${scanner}`,
      }}
    />
  );
}
