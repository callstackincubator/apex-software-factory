import * as Clipboard from "expo-clipboard";
import {
  Accelerometer,
  Barometer,
  DeviceMotion,
  Gyroscope,
  Magnetometer,
  Pedometer,
} from "expo-sensors";

import { useKeyboardProviderMounted } from "@/lib/keyboard";

import { SmokeCard, useSmoke } from "../smoke-card";

const SENSORS = { Accelerometer, Gyroscope, Magnetometer, Barometer, DeviceMotion, Pedometer };

/** Asks each sensor whether the hardware is there (a simulator has few); never starts one. */
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

/** Copies a marker string and pastes it back (the app's own content: no paste prompt). */
export function ClipboardSmoke() {
  const result = useSmoke(async () => {
    const marker = `apex-capabilities-${Date.now()}`;
    await Clipboard.setStringAsync(marker);
    const pasted = await Clipboard.getStringAsync();
    if (pasted !== marker) throw new Error(`copied ${marker}, pasted ${pasted}`);
    return "setString/getString round-trip";
  });
  return <SmokeCard id="clipboard" title="Clipboard" result={result} />;
}

/** The keyboard-controller provider must wrap the app (root layout). */
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
