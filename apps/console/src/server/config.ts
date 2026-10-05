import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const flag = z
  .string()
  .transform((v) => ["1", "true", "yes", "on"].includes(v.trim().toLowerCase()))
  .default(false);

const ConfigSchema = z
  .object({
    CONSOLE_PORT: z.coerce.number().int().min(1).max(65_535).default(4280),
    CONSOLE_HOST: z.enum(["127.0.0.1", "localhost", "::1"]).default("127.0.0.1"),
    CONSOLE_REPO: z
      .string()
      .regex(/^[\w.-]+\/[\w.-]+$/, "must be owner/name")
      .optional(),
    OPENCODE_DB: z.string().min(1).optional(),
    FACTORY_RUN_LOGS: z.string().optional(),
    CONSOLE_DEMO: flag,
  })
  .transform((env) => ({
    port: env.CONSOLE_PORT,
    host: env.CONSOLE_HOST,
    repo: env.CONSOLE_REPO,
    opencodeDb: env.OPENCODE_DB ?? join(homedir(), ".local", "share", "opencode", "opencode.db"),
    /** `undefined`: discover them (CONSOLE.md 1.3). */
    runLogDirs: env.FACTORY_RUN_LOGS?.split(":").filter((d) => d !== ""),
    demo: env.CONSOLE_DEMO,
    repoRoot: fileURLToPath(new URL("../../../../", import.meta.url)),
    home: homedir(),
    distDir: fileURLToPath(new URL("../../dist/", import.meta.url)),
  }));

export type Config = z.infer<typeof ConfigSchema>;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/**
 * The only reader of the environment. `--demo` on the command line is `CONSOLE_DEMO=1`. Throws
 * `ConfigError` listing every problem.
 */
export function loadConfig(
  env: Record<string, string | undefined> = process.env,
  argv: readonly string[] = process.argv.slice(2),
): Config {
  const merged = argv.includes("--demo") ? { ...env, CONSOLE_DEMO: "1" } : env;
  const result = ConfigSchema.safeParse(merged);
  if (!result.success) {
    throw new ConfigError(`Invalid configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
