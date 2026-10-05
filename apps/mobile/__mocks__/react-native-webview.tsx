// Jest picks this up automatically (a node module mock next to node_modules):
// the real WebView needs its native view. A plain view keeps the props, so a
// test can fire fireEvent(webview, "message", { nativeEvent: { data } }).
import { View, type ViewProps } from "react-native";

export function WebView(props: ViewProps & Record<string, unknown>) {
  return <View {...props} />;
}

export default WebView;
