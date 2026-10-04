"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const lib = require("./lib.js");

const FP_A = "e69a1971cecded2455b45e567d4af8ec70cf13c2";
const FP_B = "c273005bdb9e37a3c97b4d05ea70024a97313562";

function withCache(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apex-build-cache-"));
  const before = process.env.APEX_BUILD_CACHE_DIR;
  process.env.APEX_BUILD_CACHE_DIR = dir;
  try {
    return fn(dir);
  } finally {
    if (before === undefined) delete process.env.APEX_BUILD_CACHE_DIR;
    else process.env.APEX_BUILD_CACHE_DIR = before;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function fakeApp(dir, text) {
  const app = path.join(dir, "ApexFactory.app");
  fs.mkdirSync(app, { recursive: true });
  fs.writeFileSync(path.join(app, "main.jsbundle"), text);
  return app;
}

test("reads both platform hashes from hot-updater's fingerprint output, colours and all", () => {
  const out = `│  Fingerprint\n│      iOS:      \x1b[1m${FP_A}\x1b[22m\n│      Android:  ${FP_B}\n◆  Fingerprint mismatch.`;
  assert.deepEqual(lib.parseFingerprintOutput(out), { ios: FP_A, android: FP_B });
});

test("maps Expo's run options to the cache profile per platform", () => {
  assert.equal(lib.profileOf("ios", { configuration: "Release" }), "release");
  assert.equal(lib.profileOf("ios", { configuration: "Debug" }), "debug");
  assert.equal(lib.profileOf("android", { variant: "release" }), "release");
  assert.equal(lib.profileOf("android", {}), "debug");
});

test("refuses a cache key that is not a platform, a 40-hex fingerprint and a profile", () => {
  assert.throws(() => lib.entryDir("web", FP_A, "release", "/c"), /platform/);
  assert.throws(() => lib.entryDir("ios", "../../etc", "release", "/c"), /fingerprint/);
  assert.throws(() => lib.entryDir("ios", FP_A, "staging", "/c"), /profile/);
  assert.equal(lib.entryDir("ios", FP_A, "debug", "/c"), path.join("/c", "ios", FP_A, "debug"));
});

test("a stored debug build resolves to a copy, and the first store of a key wins", () =>
  withCache((root) => {
    const src = fs.mkdtempSync(path.join(root, "src-"));
    lib.store({
      platform: "ios",
      fingerprint: FP_A,
      profile: "debug",
      buildPath: fakeApp(src, "first"),
    });
    lib.store({
      platform: "ios",
      fingerprint: FP_A,
      profile: "debug",
      buildPath: fakeApp(src, "second"),
    });
    const out = path.join(root, "out");
    const binary = lib.resolve({
      projectRoot: root,
      platform: "ios",
      fingerprint: FP_A,
      profile: "debug",
      outDir: out,
    });
    assert.equal(binary, path.join(out, "ApexFactory.app"));
    assert.equal(fs.readFileSync(path.join(binary, "main.jsbundle"), "utf8"), "first");
    // The cache entry itself is untouched by changes to the copy.
    fs.writeFileSync(path.join(binary, "main.jsbundle"), "changed");
    const cached = lib.cachedBinary(lib.entryDir("ios", FP_A, "debug"));
    assert.equal(fs.readFileSync(path.join(cached, "main.jsbundle"), "utf8"), "first");
  }));

test("a fingerprint, profile or platform never stored is a miss", () =>
  withCache((root) => {
    const src = fs.mkdtempSync(path.join(root, "src-"));
    lib.store({
      platform: "ios",
      fingerprint: FP_A,
      profile: "debug",
      buildPath: fakeApp(src, "x"),
    });
    assert.equal(
      lib.resolve({ projectRoot: root, platform: "ios", fingerprint: FP_B, profile: "debug" }),
      null,
    );
    assert.equal(
      lib.resolve({ projectRoot: root, platform: "ios", fingerprint: FP_A, profile: "release" }),
      null,
    );
    assert.equal(
      lib.resolve({ projectRoot: root, platform: "android", fingerprint: FP_A, profile: "debug" }),
      null,
    );
  }));

test("pruning keeps the most recently used fingerprints of a platform", () =>
  withCache((root) => {
    const base = path.join(root, "ios");
    const fps = ["1", "2", "3"].map((d) => d.repeat(40));
    fps.forEach((fp, i) => {
      fs.mkdirSync(path.join(base, fp), { recursive: true });
      const t = new Date(Date.now() - (3 - i) * 60_000);
      fs.utimesSync(path.join(base, fp), t, t);
    });
    assert.deepEqual(lib.prune("ios", root, 2), [fps[0]]);
    assert.deepEqual(fs.readdirSync(base).sort(), [fps[1], fps[2]]);
  }));

test(
  "dating an iOS app writes its OTA baseline to Info.plist as HOT_UPDATER_BUILD_TIMESTAMP",
  { skip: process.platform !== "darwin" && "plutil is macOS-only" },
  () =>
    withCache((root) => {
      const app = fakeApp(root, "x");
      const plist = path.join(app, "Info.plist");
      execFileSync("plutil", ["-create", "xml1", plist]);
      lib.stampIos(app, 1791130000000);
      const out = execFileSync(
        "plutil",
        ["-extract", "HOT_UPDATER_BUILD_TIMESTAMP", "raw", plist],
        {
          encoding: "utf8",
        },
      );
      assert.equal(out.trim(), "1791130000000");
    }),
);

test("a checkout's baseline is its HEAD commit time in milliseconds", () => {
  const head = execFileSync("git", ["log", "-1", "--format=%ct"], {
    cwd: __dirname,
    encoding: "utf8",
  }).trim();
  assert.equal(lib.commitTimeMs(__dirname), Number(head) * 1000);
});

test("a lane binary's baseline is now, or its commit time with APEX_LANE_OTA=on", () => {
  const before = Date.now();
  const now = lib.baselineMs(__dirname, {});
  assert.ok(now >= before && now <= Date.now());
  assert.equal(lib.baselineMs(__dirname, { APEX_LANE_OTA: "on" }), lib.commitTimeMs(__dirname));
});

test("a lane bundle talks to no OTA server unless APEX_LANE_OTA=on", () => {
  assert.deepEqual(lib.laneBundleEnv({}), { EXPO_PUBLIC_OTA_URL: lib.OTA_OFF_URL });
  assert.deepEqual(lib.laneBundleEnv({ APEX_LANE_OTA: "off" }), {
    EXPO_PUBLIC_OTA_URL: lib.OTA_OFF_URL,
  });
  assert.deepEqual(lib.laneBundleEnv({ APEX_LANE_OTA: "on" }), {});
});
