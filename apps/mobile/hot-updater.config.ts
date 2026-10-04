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

export default defineConfig({
  build: expo({ sourcemap: false }),

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
});
