/**
 * hot-updater CLI config (ADR 0003): how `pnpm run ota:deploy` builds the JS
 * bundle, where it uploads it, and where it registers it. See
 * docs/internal/OTA.md for the booth setup.
 *
 * Every connection setting comes from the environment — CI sets real env, a
 * local run can put them in apps/mobile/.env.hotupdater (gitignored; the real
 * environment wins). They are only read when a command talks to the server or
 * the bucket (`deploy`, `console`, `bundle ...`), so `expo prebuild` and
 * `hot-updater fingerprint`, which also load this file, need no secrets.
 */
import { s3Storage } from "@hot-updater/aws";
import { expo } from "@hot-updater/expo";
import { standaloneRepository } from "@hot-updater/standalone";
import { defineConfig } from "hot-updater";

// The app's tsconfig has no Node types; this file only runs in Node 22+.
const nodeProcess = process as unknown as { loadEnvFile(path: string): void };
try {
  nodeProcess.loadEnvFile(".env.hotupdater");
} catch {
  // No file: rely on the environment.
}

/**
 * One build profile everywhere: the booth binary, its fingerprint and every
 * OTA bundle are built with APPDUCT_ENABLED=1, so appduct's native module is
 * linked in Release and its JS stays in OTA bundles. The variable changes
 * autolinking, and so the iOS fingerprint: a prebuild or fingerprint without
 * it would describe a binary no phone has. This file is loaded by both
 * (`expo prebuild` through the config plugin, and every hot-updater command),
 * so it is the one place that refuses. The package scripts set it, and
 * `scripts/hot-updater.mjs` defaults it.
 */
if (process.env.APPDUCT_ENABLED !== "1") {
  throw new Error(
    `hot-updater: APPDUCT_ENABLED must be 1 (got ${JSON.stringify(process.env.APPDUCT_ENABLED ?? null)}).\n` +
      "Every native build, fingerprint and OTA deploy uses the same profile. Use the package " +
      "scripts (pnpm --filter @apex/mobile run ios|android|prebuild|ota:*), or prefix the " +
      "command with APPDUCT_ENABLED=1; see docs/internal/OTA.md.",
  );
}

const REQUIRED = [
  // OTA server base URL, e.g. http://localhost:3002/hot-updater
  "HOT_UPDATER_SERVER_URL",
  // Bearer token for the server's management API (apps/ota-server/.env)
  "HOT_UPDATER_AUTH_TOKEN",
  // MinIO as the laptop reaches it, e.g. http://127.0.0.1:9000
  "S3_ENDPOINT",
  "S3_REGION",
  "S3_BUCKET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
] as const;

type Env = Record<(typeof REQUIRED)[number], string>;

/** Reads every required variable, or throws one error naming all missing ones. */
function readEnv(): Env {
  const missing = REQUIRED.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(
      `hot-updater: missing environment variable(s): ${missing.join(", ")}.\n` +
        "Set them in the environment (CI) or in apps/mobile/.env.hotupdater (local); " +
        "see docs/internal/OTA.md.",
    );
  }
  return Object.fromEntries(REQUIRED.map((name) => [name, process.env[name]])) as Env;
}

/**
 * `EXPO_PUBLIC_*` values are inlined into the JS bundle, and an OTA bundle
 * replaces the binary's JS — so a bundle built without them would point the
 * phone at the localhost defaults and it would never hear from the laptop
 * again. Deploys must pass the same values the installed binary was built with.
 */
const BUNDLE_ENV = ["EXPO_PUBLIC_OTA_URL", "EXPO_PUBLIC_API_URL"] as const;

function requireBundleEnv(): void {
  const missing = BUNDLE_ENV.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(
      `hot-updater: missing environment variable(s): ${missing.join(", ")}.\n` +
        "Set them to the values the installed binary was built with " +
        "(e.g. http://<laptop-lan-ip>:3002/hot-updater and http://<laptop-lan-ip>:3001); " +
        "see docs/internal/OTA.md.",
    );
  }
}

export default defineConfig({
  // Only `deploy` builds, so only `deploy` needs the bundle's public env.
  build: (args) => {
    requireBundleEnv();
    return expo({ sourcemap: false })(args);
  },

  // Same bucket as apps/ota-server. The CLI uploads from the laptop, so this
  // is the internal endpoint; devices get URLs presigned by the server.
  storage: () => {
    const env = readEnv();
    return s3Storage({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      forcePathStyle: true,
      bucketName: env.S3_BUCKET,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      },
    })();
  },

  // Bundle metadata goes to the self-hosted server's management API.
  database: () => {
    const env = readEnv();
    return standaloneRepository({
      baseUrl: env.HOT_UPDATER_SERVER_URL,
      commonHeaders: { Authorization: `Bearer ${env.HOT_UPDATER_AUTH_TOKEN}` },
    })();
  },

  // A bundle only reaches binaries whose native fingerprint matches; deploy
  // refuses when the project no longer matches fingerprint.json.
  updateStrategy: "fingerprint",
  fingerprint: {
    // hot-updater hashes native sources of autolinked modules but skips the
    // Expo config entirely. With CNG, app.json (plugins, Info.plist keys,
    // permissions, cleartext) *is* native configuration, so hash it too.
    extraSources: ["app.json"],
  },
});
