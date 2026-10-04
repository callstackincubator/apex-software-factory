#!/usr/bin/env node
// Runs the hot-updater CLI for the `ota:*` scripts in package.json.
//
// - Options pass straight through:
//     pnpm --filter @apex/mobile run ota:deploy -p ios -c production -m "<msg>"
//   pnpm forwards a literal `--` to the script, and hot-updater (commander)
//   would treat everything after it as stray arguments, so a `--` right after
//   the subcommand is dropped (`run ota:deploy -- -p ios` works too).
// - When hot-updater reports a fingerprint problem, one more line says what it
//   means for the booth: the change needs a native build. The exit code is
//   always hot-updater's.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const [command, ...rest] = process.argv.slice(2);
if (rest[0] === "--") rest.shift();
const args = command ? [command, ...rest] : rest;

const require = createRequire(import.meta.url);
const pkgPath = require.resolve("hot-updater/package.json");
const bin = join(dirname(pkgPath), require(pkgPath).bin["hot-updater"]);

// hot-updater's own wording (0.36): "Fingerprint mismatch.",
// "Fingerprint.json not found", "Fingerprint hash not found", and
// "iOS/Android fingerprint mismatch" from `hot-updater fingerprint`.
const FINGERPRINT_PROBLEM =
  /fingerprint mismatch|fingerprint\.json not found|fingerprint hash not found/i;
let fingerprintProblem = false;

const child = spawn(process.execPath, [bin, ...args], { stdio: ["inherit", "pipe", "pipe"] });
for (const [from, to] of [
  [child.stdout, process.stdout],
  [child.stderr, process.stderr],
]) {
  from.on("data", (chunk) => {
    if (FINGERPRINT_PROBLEM.test(chunk.toString())) fingerprintProblem = true;
    to.write(chunk);
  });
}

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
child.on("close", (code, signal) => {
  const status = code ?? (signal ? 1 : 0);
  if (status !== 0 && fingerprintProblem) {
    console.error(
      "\nota: the native fingerprint does not match fingerprint.json — this change needs a native build.\n" +
        "It cannot ship over the air: build and install a new binary (which rewrites fingerprint.json) " +
        "and commit fingerprint.json with the change.",
    );
  }
  process.exit(status);
});
