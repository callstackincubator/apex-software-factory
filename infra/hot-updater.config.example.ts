/**
 * Template for apps/mobile/hot-updater.config.ts — copy it there when the
 * mobile app adopts hot-updater (ADR 0003). Not used from this directory.
 *
 * The mobile app needs (dev dependencies, same version as apps/ota-server):
 *   hot-updater @hot-updater/expo @hot-updater/aws @hot-updater/standalone
 *   @expo/fingerprint
 * plus `@hot-updater/react-native` as a dependency and its Expo config plugin
 * in app.json: ["@hot-updater/react-native", { "channel": "production" }].
 *
 * CI (ota-publish.yml on the booth runner), from apps/mobile:
 *   pnpm exec hot-updater deploy -p ios -c production -m "<merge subject>"
 *   pnpm exec hot-updater deploy -p android -c production -m "<merge subject>"
 * Non-interactive by default (no -i). With updateStrategy "fingerprint" the
 * deploy fails if native code changed since the installed binary was built —
 * that is the "needs a native build" signal. See docs/internal/OTA.md.
 */
import { s3Storage } from "@hot-updater/aws";
import { expo } from "@hot-updater/expo";
import { standaloneRepository } from "@hot-updater/standalone";
import { defineConfig } from "hot-updater";

// Local runs read apps/mobile/.env.hotupdater (gitignored); CI sets real env.
try {
  process.loadEnvFile(".env.hotupdater");
} catch {
  // No file: rely on the environment.
}

const env = (name: string, fallback?: string): string => {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`${name} is required for hot-updater (see docs/internal/OTA.md)`);
  return value;
};

export default defineConfig({
  build: expo({ sourcemap: false }),

  // Must match the storage in apps/ota-server (s3Storage on the same bucket).
  // The CLI uploads from the laptop, so the internal endpoint is right here;
  // devices never see this URL (the server presigns LAN download URLs).
  storage: s3Storage({
    endpoint: env("S3_ENDPOINT", "http://127.0.0.1:9000"),
    region: env("S3_REGION", "us-east-1"),
    forcePathStyle: true,
    bucketName: env("S3_BUCKET", "hot-updater"),
    credentials: {
      accessKeyId: env("S3_ACCESS_KEY_ID"),
      secretAccessKey: env("S3_SECRET_ACCESS_KEY"),
    },
  }),

  // Bundle metadata goes to the self-hosted server's management API.
  database: standaloneRepository({
    baseUrl: env("HOT_UPDATER_SERVER_URL", "http://127.0.0.1:3002/hot-updater"),
    commonHeaders: { Authorization: `Bearer ${env("HOT_UPDATER_AUTH_TOKEN")}` },
  }),

  updateStrategy: "fingerprint",
});
