import { execFile } from "node:child_process";

export class OpencodeUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpencodeUnavailable";
  }
}

export type Exec = (
  file: string,
  args: string[],
  options: { cwd: string; timeout: number },
) => Promise<{ stdout: string; stderr: string }>;

export const realExec: Exec = (file, args, options) =>
  new Promise((resolve, reject) => {
    execFile(file, args, { ...options, env: process.env }, (error, stdout, stderr) => {
      if (error) reject(Object.assign(error, { stdout, stderr }));
      else resolve({ stdout, stderr });
    });
  });

export interface OpencodeCli {
  /** Whether the `opencode` CLI is on PATH, and its version; cached. */
  info(): Promise<{ available: boolean; version?: string }>;
  /** Runs `opencode pair` and answers its first loopback one-time link. */
  pair(): Promise<{ url: string; expiresInMinutes: number }>;
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** The first link in `opencode pair`'s output that is on a loopback host; others are ignored. */
export function loopbackLink(output: string): string | null {
  for (const match of output.matchAll(/https?:\/\/[^\s]+/g)) {
    try {
      const url = new URL(match[0]);
      if (LOOPBACK.has(url.hostname)) return url.href;
    } catch {
      // Not a URL: ignore it.
    }
  }
  return null;
}

function tail(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > 400 ? `…${trimmed.slice(-400)}` : trimmed;
}

/**
 * The `opencode` CLI, run in the repository root. v2 has no `opencode web`: `opencode pair`
 * starts the background service if needed and prints one-time sign-in links. The console never
 * sees OpenCode's server password.
 */
export function createOpencodeCli(options: {
  cwd: string;
  exec?: Exec;
  ttlMs?: number;
  now?: () => number;
}): OpencodeCli {
  const exec = options.exec ?? realExec;
  const now = options.now ?? Date.now;
  const ttl = options.ttlMs ?? 5 * 60_000;
  let cached: { at: number; value: { available: boolean; version?: string } } | null = null;

  return {
    async info() {
      if (cached && now() - cached.at < ttl) return cached.value;
      let value: { available: boolean; version?: string };
      try {
        const { stdout } = await exec("opencode", ["--version"], {
          cwd: options.cwd,
          timeout: 5_000,
        });
        const version = stdout.trim().split(/\s+/).pop() ?? "";
        value = version === "" ? { available: true } : { available: true, version };
      } catch {
        value = { available: false };
      }
      cached = { at: now(), value };
      return value;
    },
    async pair() {
      let out: { stdout: string; stderr: string };
      try {
        out = await exec("opencode", ["pair"], { cwd: options.cwd, timeout: 30_000 });
      } catch (error) {
        const e = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
        if (e.code === "ENOENT") throw new OpencodeUnavailable("opencode is not on PATH");
        const said = tail(`${e.stderr ?? ""}\n${e.stdout ?? ""}`);
        throw new OpencodeUnavailable(said === "" ? `opencode pair failed: ${e.message}` : said);
      }
      const url = loopbackLink(out.stdout) ?? loopbackLink(out.stderr);
      if (url === null) {
        const said = tail(`${out.stderr}\n${out.stdout}`);
        throw new OpencodeUnavailable(
          said === ""
            ? "opencode pair printed no link"
            : `opencode pair printed no loopback link: ${said}`,
        );
      }
      const expires = /expire[^\d]*(\d+)\s*minute/i.exec(out.stdout);
      return { url, expiresInMinutes: expires ? Number(expires[1]) : 5 };
    },
  };
}
