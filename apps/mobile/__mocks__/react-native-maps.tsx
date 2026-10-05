// Jest picks this up automatically (a node module mock next to node_modules):
// the real MapView needs its native view. A plain view keeps the props, so a
// test can fire the map's events: fireEvent(map, "mapReady").
import { View, type ViewProps } from "react-native";

export default function MapView(props: ViewProps & Record<string, unknown>) {
  return <View {...props} />;
}

export const Marker = View;
export const PROVIDER_DEFAULT = undefined;
export const PROVIDER_GOOGLE = "google";
