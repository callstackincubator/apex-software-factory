#!/usr/bin/env node
// The native build cache (lib.js) for scripts: .agents/scripts/device-lane.sh and
// .agents/scripts/prewarm.sh. Same cache, same key as the Expo provider.
//
//   cli.js fingerprint <ios|android> <projectRoot>
//       prints the OTA fingerprint (hot-updater's) of the app at projectRoot
//   cli.js resolve <ios|android> <release|debug> <projectRoot> <fingerprint> [outDir]
//       exit 0 and the binary's path (a copy, with this checkout's JS for release) on a hit;
//       exit 3 on a miss
//   cli.js store <ios|android> <release|debug> <fingerprint> <buildPath> [commit]
//       stores a fresh build; prints the cache entry
//   cli.js list
//       every cache entry
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const lib = require("./lib.js");

const [cmd, ...args] = process.argv.slice(2);
const usage = () => {
  console.error(fs.readFileSync(__filename, "utf8").split("\n").slice(1, 15).join("\n"));
  process.exit(64);
};

try {
  switch (cmd) {
    case "fingerprint": {
      const [platform, projectRoot] = args;
      if (!platform || !projectRoot) usage();
      console.log(lib.fingerprint(path.resolve(projectRoot), platform));
      break;
    }
    case "resolve": {
      const [platform, profile, projectRoot, fingerprint, outDir] = args;
      if (!fingerprint) usage();
      const binary = lib.resolve({
        projectRoot: path.resolve(projectRoot),
        platform,
        profile,
        fingerprint,
        outDir: outDir && path.resolve(outDir),
      });
      if (!binary) process.exit(3);
      console.log(binary);
      break;
    }
    case "store": {
      const [platform, profile, fingerprint, buildPath, commit] = args;
      if (!buildPath) usage();
      console.log(
        lib.store({
          platform,
          profile,
          fingerprint,
          buildPath,
          meta: { by: "device-lane", commit },
        }),
      );
      break;
    }
    case "list": {
      const root = lib.cacheRoot();
      for (const platform of ["ios", "android"]) {
        const base = path.join(root, platform);
        if (!fs.existsSync(base)) continue;
        for (const fp of fs.readdirSync(base)) {
          for (const profile of ["release", "debug"]) {
            const dir = path.join(base, fp, profile);
            if (lib.cachedBinary(dir)) console.log(`${platform} ${profile} ${fp} ${dir}`);
          }
        }
      }
      break;
    }
    default:
      usage();
  }
} catch (error) {
  console.error(`build cache: ${error.message}`);
  process.exit(1);
}
