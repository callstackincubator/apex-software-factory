import MapView from "react-native-maps";
import { WebView } from "react-native-webview";

import { SmokeCard, useRenderSmoke } from "../smoke-card";

const PAGE = `<!doctype html><meta name="viewport" content="width=device-width">
<body style="margin:0;font:600 15px -apple-system,sans-serif;background:#141417;color:#C6F432;display:flex;align-items:center;justify-content:center;height:100vh">
<span>WebView: page loaded</span>
<script>window.ReactNativeWebView.postMessage("ready")</script></body>`;

/**
 * Loads an HTML string whose script posts a message back. Not a `data:` URL:
 * react-native-webview 13.16 on iOS hands any URL without a host to
 * `loadFileURL`, which throws and crashes the app.
 */
export function WebViewSmoke() {
  const [result, setResult] = useRenderSmoke("WebView");
  return (
    <SmokeCard id="webview" title="WebView" result={result}>
      <WebView
        testID="webview-view"
        style={{ height: 64, backgroundColor: "transparent" }}
        originWhitelist={["*"]}
        source={{ html: PAGE, baseUrl: "about:blank" }}
        scrollEnabled={false}
        onMessage={(event) => {
          if (event.nativeEvent.data === "ready") {
            setResult({ status: "ok", detail: "HTML loaded, its script posted back" });
          }
        }}
        onError={(event) =>
          setResult({ status: "failed", detail: event.nativeEvent.description || "load error" })
        }
      />
    </SmokeCard>
  );
}

const BERLIN = {
  latitude: 52.5072,
  longitude: 13.4245,
  latitudeDelta: 0.08,
  longitudeDelta: 0.08,
};

/**
 * Mounts a map over Berlin; passes on onMapReady. An Android binary built
 * without GOOGLE_MAPS_ANDROID_API_KEY shows an empty grid instead of tiles
 * (docs/internal/NATIVE-CAPABILITIES.md).
 */
export function MapsSmoke() {
  const [result, setResult] = useRenderSmoke("MapView");
  return (
    <SmokeCard id="maps" title="Maps" result={result}>
      <MapView
        testID="map-view"
        style={{ height: 140, borderRadius: 8 }}
        initialRegion={BERLIN}
        scrollEnabled={false}
        zoomEnabled={false}
        accessibilityLabel="Map of Berlin"
        onMapReady={() =>
          setResult({
            status: "ok",
            detail: process.env.EXPO_OS === "ios" ? "Apple Maps ready" : "Google Maps view ready",
          })
        }
      />
    </SmokeCard>
  );
}
