import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { WatchdogStop } from "../shared/schema.ts";

const STOPPED = /^(\d+)-(\d+)-(\d{8}-\d{6})\.log\.stopped$/;

/** The `.stopped` files the watchdog (`factory-run.sh`) leaves, one per stopped attempt. */
export function readStops(dirs: readonly string[]): WatchdogStop[] {
  const stops: WatchdogStop[] = [];
  for (const dir of dirs) {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      const m = STOPPED.exec(name);
      if (!m) continue;
      const file = join(dir, name);
      try {
        stops.push({
          at: statSync(file).mtimeMs,
          issue: Number(m[1]),
          attempt: Number(m[2]),
          reason: readFileSync(file, "utf8").trim() || "no reason recorded",
        });
      } catch {
        // A file that vanished between the listing and the read is not a stop.
      }
    }
  }
  return stops.sort((a, b) => b.at - a.at);
}

/** Every `~/actions-runner-factory-*` checkout's run-log directory that exists, and the repo's own. */
export function discoverRunLogDirs(home: string, repoRoot: string): string[] {
  const dirs: string[] = [];
  const list = (path: string): string[] => {
    try {
      return readdirSync(path);
    } catch {
      return [];
    }
  };
  for (const runner of list(home).filter((n) => n.startsWith("actions-runner-factory-"))) {
    const work = join(home, runner, "_work");
    for (const owner of list(work)) {
      for (const repo of list(join(work, owner))) {
        dirs.push(join(work, owner, repo, ".worktrees", "factory-runs"));
      }
    }
  }
  dirs.push(join(repoRoot, ".worktrees", "factory-runs"));
  return dirs.filter((dir) => {
    try {
      return statSync(dir).isDirectory();
    } catch {
      return false;
    }
  });
}
