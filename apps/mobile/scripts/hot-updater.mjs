#!/usr/bin/env node
// Runs the hot-updater CLI for the `ota:*` scripts in package.json.
//
// `pnpm --filter @apex/mobile run ota:deploy -- -p ios ...` forwards the
// literal `--` to the script, and hot-updater (commander) would then treat
// `-p ios` as stray arguments instead of options. Drop that separator when it
// directly follows the subcommand and pass everything else through; the exit
// code is hot-updater's.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const [command, ...rest] = process.argv.slice(2);
if (rest[0] === "--") rest.shift();
const args = command ? [command, ...rest] : rest;

const require = createRequire(import.meta.url);
const pkgPath = require.resolve("hot-updater/package.json");
const bin = join(dirname(pkgPath), require(pkgPath).bin["hot-updater"]);

const result = spawnSync(process.execPath, [bin, ...args], { stdio: "inherit" });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
