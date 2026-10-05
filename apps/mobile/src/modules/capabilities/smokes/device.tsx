import * as Clipboard from "expo-clipboard";
import {
  Accelerometer,
  Barometer,
  DeviceMotion,
  Gyroscope,
  Magnetometer,
  Pedometer,
} from "expo-sensors";

import { useKeyboardProviderMounted } from "@/modules/ui";

import { SmokeCard, useSmoke, withTimeout } from "../smoke-card";

const SENSORS = { Accelerometer, Gyroscope, Magnetometer, Barometer, DeviceMotion, Pedometer };

export function SensorsSmoke() {
  const result = useSmoke(async () => {
    const answers = await Promise.all(
      Object.entries(SENSORS).map(async ([name, sensor]) => {
        const available = await sensor.isAvailableAsync();
        return `${name.toLowerCase()} ${available ? "yes" : "no"}`;
      }),
    );
    return { status: "info", detail: `available: ${answers.join(", ")}` };
  });
  return <SmokeCard id="sensors" title="Sensors" result={result} />;
}

// The app's own content, so iOS shows no paste prompt.
export function ClipboardSmoke() {
  const result = useSmoke(async () => {
    const marker = `apex-capabilities-${Date.now()}`;
    await withTimeout(Clipboard.setStringAsync(marker), "setStringAsync");
    const pasted = await withTimeout(Clipboard.getStringAsync(), "getStringAsync");
    if (pasted !== marker) throw new Error(`copied ${marker}, pasted ${pasted}`);
    return "setString/getString round-trip";
  });
  return <SmokeCard id="clipboard" title="Clipboard" result={result} />;
}

export function KeyboardSmoke() {
  const mounted = useKeyboardProviderMounted();
  return (
    <SmokeCard
      id="keyboard-controller"
      title="Keyboard controller"
      result={
        mounted
          ? { status: "ok", detail: "KeyboardProvider mounted at the root" }
          : { status: "failed", detail: "no KeyboardProvider above this screen" }
      }
    />
  );
}
