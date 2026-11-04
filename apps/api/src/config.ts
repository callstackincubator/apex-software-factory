import { z } from "zod";
import packageJson from "../package.json" with { type: "json" };

const SharedSchema = z.object({
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  APP_VERSION: z.string().min(1).default(packageJson.version),
});

const NodeSchema = SharedSchema.extend({
  PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  // 0.0.0.0, not localhost: phones on the booth LAN must reach the laptop.
  HOST: z.string().min(1).default("0.0.0.0"),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(0).default(10_000),
});

export type Config = {
  logLevel: z.infer<typeof SharedSchema>["LOG_LEVEL"];
  appVersion: string;
};

export type NodeConfig = Config & {
  port: number;
  host: string;
  shutdownTimeoutMs: number;
};

export type Env = Record<string, unknown>;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

function parse<T extends z.ZodType>(schema: T, env: Env): z.infer<T> {
  const result = schema.safeParse(env);
  if (!result.success) {
    throw new ConfigError(`Invalid configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

export function loadConfig(env: Env): Config {
  const parsed = parse(SharedSchema, env);
  return { logLevel: parsed.LOG_LEVEL, appVersion: parsed.APP_VERSION };
}

export function loadNodeConfig(env: Env = process.env): NodeConfig {
  const parsed = parse(NodeSchema, env);
  return {
    logLevel: parsed.LOG_LEVEL,
    appVersion: parsed.APP_VERSION,
    port: parsed.PORT,
    host: parsed.HOST,
    shutdownTimeoutMs: parsed.SHUTDOWN_TIMEOUT_MS,
  };
}
