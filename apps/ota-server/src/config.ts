import { fileURLToPath } from "node:url";
import { z } from "zod";

const DEFAULT_DATABASE_PATH = fileURLToPath(new URL("../data/ota.sqlite", import.meta.url));

const url = z.url({ protocol: /^https?$/ });

/**
 * Environment contract of the OTA server. Every variable is documented in
 * `apps/ota-server/.env.example`; a bad value fails startup.
 */
export const envSchema = z.object({
  HOST: z.string().min(1).default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3002),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  HOT_UPDATER_AUTH_TOKEN: z
    .string()
    .min(32, "HOT_UPDATER_AUTH_TOKEN must be at least 32 characters (openssl rand -hex 32)"),
  DATABASE_PATH: z.string().min(1).default(DEFAULT_DATABASE_PATH),
  S3_ENDPOINT: url.default("http://127.0.0.1:9000"),
  S3_PUBLIC_ENDPOINT: z.union([z.literal("auto"), url]).default("auto"),
  S3_REGION: z.string().min(1).default("us-east-1"),
  S3_BUCKET: z.string().min(3).default("hot-updater"),
  S3_ACCESS_KEY_ID: z.string().min(3),
  S3_SECRET_ACCESS_KEY: z.string().min(8),
});

export type Env = z.infer<typeof envSchema>;

export interface S3Config {
  /** Where this server reaches MinIO (server-side reads). */
  readonly endpoint: string;
  /**
   * Origin signed into the download URLs handed to devices. `"auto"` derives
   * it from the host the device used to reach this server.
   */
  readonly publicEndpoint: "auto" | string;
  readonly region: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

export interface OtaConfig {
  readonly host: string;
  readonly port: number;
  readonly logLevel: Env["LOG_LEVEL"];
  readonly authToken: string;
  readonly databasePath: string;
  readonly s3: S3Config;
}

export function loadConfig(env: NodeJS.ProcessEnv): OtaConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid OTA server environment:\n${z.prettifyError(parsed.error)}`);
  }
  const e = parsed.data;
  return {
    host: e.HOST,
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    authToken: e.HOT_UPDATER_AUTH_TOKEN,
    databasePath: e.DATABASE_PATH,
    s3: {
      endpoint: e.S3_ENDPOINT,
      publicEndpoint: e.S3_PUBLIC_ENDPOINT,
      region: e.S3_REGION,
      bucket: e.S3_BUCKET,
      accessKeyId: e.S3_ACCESS_KEY_ID,
      secretAccessKey: e.S3_SECRET_ACCESS_KEY,
    },
  };
}

/** Loads `apps/ota-server/.env` into `process.env` when it exists. */
export function loadDotEnv(): void {
  const path = fileURLToPath(new URL("../.env", import.meta.url));
  try {
    process.loadEnvFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
