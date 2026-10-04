import { readFileSync } from "node:fs";
import { z } from "zod";

const packageJson = z
  .object({ version: z.string() })
  .parse(JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")));

const ConfigSchema = z
  .object({
    PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
    // 0.0.0.0, not localhost: phones on the booth LAN must reach the laptop.
    HOST: z.string().min(1).default("0.0.0.0"),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    APP_VERSION: z.string().min(1).default(packageJson.version),
    // How long SIGTERM waits for in-flight requests before forcing exit.
    SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(0).default(10_000),
  })
  .transform((env) => ({
    port: env.PORT,
    host: env.HOST,
    logLevel: env.LOG_LEVEL,
    appVersion: env.APP_VERSION,
    shutdownTimeoutMs: env.SHUTDOWN_TIMEOUT_MS,
  }));

export type Config = z.infer<typeof ConfigSchema>;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/** Parses configuration from environment variables; throws `ConfigError` listing every problem. */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const result = ConfigSchema.safeParse(env);
  if (!result.success) {
    throw new ConfigError(`Invalid configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
