// Jest picks this up automatically (a node module mock next to node_modules):
// the real package creates its Nitro hybrid object when it is imported. Like a
// simulator: permission not asked yet, no cameras. Tests override with
// jest.mocked(useCameraPermission).mockReturnValue(...).
import { View } from "react-native";

export const useCameraPermission = jest.fn(() => ({
  status: "not-determined",
  hasPermission: false,
  canRequestPermission: true,
  requestPermission: jest.fn(async () => false),
}));

export const useCameraDevices = jest.fn(() => []);
export const useCameraDevice = jest.fn(() => undefined);
export const Camera = View;
