// The booth's native build cache (ADR 0010): built simulator apps and APKs, keyed by the native
// fingerprint hot-updater computes for OTA updates, so "same key" means "this binary runs this
// JS". Shared by `expo run:[ios|android]` (through provider.plugin.js, Expo's build cache
// provider) and by .agents/scripts/device-lane.sh (through cli.js), so people and agents fill
// and use one cache.
//
// Storage is a directory on the booth laptop, not MinIO: every builder (the developer, both
// factory runners, every agent lane) is the same user on the same machine, an APFS clone of a
// cached .app costs nothing, and an agent lane never needs the S3 credentials (agents may not
// read .env files; safety rule 1).
//
//   <root>/<platform>/<fingerprint>/<profile>/<ApexFactory.app | app.apk>  + meta.json
//   root: $APEX_BUILD_CACHE_DIR, default ~/.cache/apex-software-factory/native
//
// A Release hit gets the current checkout's JS swapped in (swapJsBundle): the JS bundle,
// compiled to Hermes bytecode like Xcode's and Gradle's bundle step, its assets, and on iOS the
// embedded app config. A debug hit needs nothing: a debug build loads its JS from Metro.
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const KEEP_PER_PLATFORM = Number(process.env.APEX_BUILD_CACHE_KEEP || 8);

function cacheRoot() {
  return (
    process.env.APEX_BUILD_CACHE_DIR ||
    path.join(os.homedir(), ".cache", "apex-software-factory", "native")
  );
}

/** "release" or "debug", from Expo's run options or a device-lane profile. */
function profileOf(platform, runOptions = {}) {
  const raw = platform === "ios" ? runOptions.configuration : runOptions.variant;
  return String(raw || "debug").toLowerCase() === "release" ? "release" : "debug";
}

const FINGERPRINT = /^[0-9a-f]{40}$/;

function entryDir(platform, fingerprint, profile, root = cacheRoot()) {
  if (platform !== "ios" && platform !== "android") throw new Error(`platform: ${platform}`);
  if (!FINGERPRINT.test(fingerprint)) throw new Error(`not a fingerprint: ${fingerprint}`);
  if (profile !== "release" && profile !== "debug") throw new Error(`profile: ${profile}`);
  return path.join(root, platform, fingerprint, profile);
}

/** The binary inside a cache entry, or null. */
function cachedBinary(dir) {
  if (!fs.existsSync(path.join(dir, "meta.json"))) return null;
  const name = fs.readdirSync(dir).find((f) => f.endsWith(".app") || f.endsWith(".apk"));
  return name ? path.join(dir, name) : null;
}

/**
 * Parses `hot-updater fingerprint` output. Returns { ios, android } (either may be missing).
 * The CLI prints "iOS: <hash>" and "Android: <hash>" whether or not they match fingerprint.json.
 */
function parseFingerprintOutput(text) {
  // oxlint-disable-next-line no-control-regex -- strips ANSI colour codes
  const plain = String(text).replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
  const pick = (label) => plain.match(new RegExp(`${label}:\\s+([0-9a-f]{40})`))?.[1];
  return { ios: pick("iOS"), android: pick("Android") };
}

/**
 * The OTA fingerprint of the app at projectRoot (apps/mobile), computed by hot-updater itself
 * with the project's config (app.json as an extra source) and APPDUCT_ENABLED=1, so the cache
 * key is exactly the hash a binary built from this checkout embeds and an OTA bundle targets.
 */
function fingerprint(projectRoot, platform) {
  const script = path.join(projectRoot, "scripts", "hot-updater.mjs");
  const run = spawnSync(process.execPath, [script, "fingerprint"], {
    cwd: projectRoot,
    env: { ...process.env, APPDUCT_ENABLED: "1" },
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  const hash = parseFingerprintOutput(`${run.stdout}\n${run.stderr}`)[platform];
  if (!hash) {
    throw new Error(`no ${platform} fingerprint from hot-updater:\n${run.stdout}${run.stderr}`);
  }
  return hash;
}

/** Copies a file or bundle, as an APFS clone where the filesystem allows (no data copied). */
function cloneCopy(from, to) {
  fs.rmSync(to, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(to), { recursive: true });
  const r = spawnSync("cp", ["-c", "-R", from, to]);
  if (r.status !== 0) fs.cpSync(from, to, { recursive: true });
}

/** Stores a fresh build. Atomic: concurrent uploads of one key keep the first. */
function store({ platform, fingerprint: fp, profile, buildPath, meta = {} }) {
  const dir = entryDir(platform, fp, profile);
  if (cachedBinary(dir)) return dir;
  const tmp = `${dir}.tmp-${process.pid}-${crypto.randomBytes(3).toString("hex")}`;
  const name = platform === "ios" ? path.basename(buildPath) : "app.apk";
  cloneCopy(buildPath, path.join(tmp, name));
  fs.writeFileSync(
    path.join(tmp, "meta.json"),
    JSON.stringify(
      { platform, fingerprint: fp, profile, storedAt: new Date().toISOString(), ...meta },
      null,
      2,
    ) + "\n",
  );
  try {
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    fs.renameSync(tmp, dir);
  } catch {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  prune(platform);
  return dir;
}

/** Keeps the KEEP_PER_PLATFORM most recently used fingerprints per platform. */
function prune(platform, root = cacheRoot(), keep = KEEP_PER_PLATFORM) {
  const base = path.join(root, platform);
  if (!fs.existsSync(base)) return [];
  const entries = fs
    .readdirSync(base)
    .filter((f) => FINGERPRINT.test(f))
    .map((f) => ({ f, t: fs.statSync(path.join(base, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  const gone = entries.slice(keep).map((e) => e.f);
  for (const f of gone) fs.rmSync(path.join(base, f), { recursive: true, force: true });
  return gone;
}

function resolveFrom(projectRoot, request) {
  return require.resolve(request, { paths: [projectRoot] });
}

function run(cmd, args, opts) {
  execFileSync(cmd, args, { stdio: ["ignore", 2, 2], ...opts }); // stdout stays the result channel
}

/** The Hermes compiler that matches the app's React Native. */
function hermesc(projectRoot) {
  const rn = path.dirname(resolveFrom(projectRoot, "react-native/package.json"));
  const pkg = path.dirname(require.resolve("hermes-compiler/package.json", { paths: [rn] }));
  const bin = path.join(
    pkg,
    "hermesc",
    process.platform === "darwin" ? "osx-bin" : "linux64-bin",
    "hermesc",
  );
  if (!fs.existsSync(bin)) throw new Error(`hermesc not found at ${bin}`);
  return bin;
}

/**
 * Bundles the checkout's JS the way the native build's bundle step does
 * (react-native-xcode.sh / the RN Gradle plugin: `expo export:embed`, unminified, then
 * `hermesc -O`), into `bundle` with assets under `assetsDest`.
 */
function bundleJs(projectRoot, platform, bundle, assetsDest) {
  const entry = execFileSync(
    process.execPath,
    ["-e", "require('expo/scripts/resolveAppEntry')", "--", projectRoot, platform, "absolute"],
    { cwd: projectRoot, encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .pop();
  const expoCli = resolveFrom(projectRoot, "expo/bin/cli");
  const raw = `${bundle}.js`;
  fs.mkdirSync(path.dirname(bundle), { recursive: true });
  fs.mkdirSync(assetsDest, { recursive: true });
  run(
    process.execPath,
    [
      expoCli,
      "export:embed",
      "--entry-file",
      entry,
      "--platform",
      platform,
      "--dev",
      "false",
      "--minify",
      "false",
      "--bundle-output",
      raw,
      "--assets-dest",
      assetsDest,
    ],
    {
      cwd: projectRoot,
      // The booth binary's profile (ADR 0007): appduct on, Rozenite off.
      env: { ...process.env, APPDUCT_ENABLED: "1", WITH_ROZENITE: "", NODE_ENV: "production" },
    },
  );
  run(hermesc(projectRoot), [
    "-emit-binary",
    "-max-diagnostic-width=80",
    "-O",
    "-out",
    bundle,
    raw,
  ]);
  fs.rmSync(raw, { force: true });
}

function listFiles(dir, prefix = "") {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const rel = path.join(prefix, d.name);
    return d.isDirectory() ? listFiles(path.join(dir, d.name), rel) : [rel];
  });
}

/** iOS: a copy of the cached .app with this checkout's JS, assets and app config in it. */
function swapIos(projectRoot, app) {
  fs.rmSync(path.join(app, "assets"), { recursive: true, force: true });
  bundleJs(projectRoot, "ios", path.join(app, "main.jsbundle"), app);
  // The embedded Expo config (name, version and other fields the fingerprint skips).
  const constants = path.dirname(resolveFrom(projectRoot, "expo-constants/package.json"));
  run(
    process.execPath,
    [
      path.join(constants, "scripts", "getAppConfig.js"),
      projectRoot,
      path.join(app, "EXConstants.bundle"),
    ],
    {
      cwd: projectRoot,
      env: { ...process.env, APPDUCT_ENABLED: "1", NODE_ENV: "production" },
    },
  );
  // A simulator app built with CODE_SIGNING_ALLOWED=NO has no signature; one `expo run:ios`
  // signed ad hoc gets a fresh ad-hoc signature over the new resources.
  if (fs.existsSync(path.join(app, "_CodeSignature"))) {
    run("codesign", [
      "--force",
      "--sign",
      "-",
      "--preserve-metadata=entitlements",
      "--timestamp=none",
      app,
    ]);
  }
}

function androidBuildTools() {
  const sdk = process.env.ANDROID_HOME || path.join(os.homedir(), "Library", "Android", "sdk");
  const dir = path.join(sdk, "build-tools");
  const versions = fs.existsSync(dir)
    ? fs.readdirSync(dir).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    : [];
  const v = versions.pop();
  if (!v) throw new Error(`no Android build-tools under ${dir}`);
  return path.join(dir, v);
}

/**
 * Android: a copy of the cached APK with this checkout's JS bundle (assets/index.android.bundle)
 * and JS images (res/drawable-*), zipaligned and signed with the debug key the cached APK was
 * signed with. Images go into compiled resources, so a JS change that adds an image the cached
 * APK lacks cannot be swapped: returns false and the caller builds instead.
 */
function swapAndroid(projectRoot, apk, work) {
  const res = path.join(work, "res");
  const bundle = path.join(work, "assets", "index.android.bundle");
  bundleJs(projectRoot, "android", bundle, res);
  const images = listFiles(res).map((f) => path.join("res", f));
  if (images.length) {
    const inApk = new Set(
      execFileSync("unzip", ["-Z1", apk], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split(
        "\n",
      ),
    );
    const missing = images.filter((f) => !inApk.has(f));
    if (missing.length) {
      console.error(`build cache: new JS images need a resource build: ${missing.join(", ")}`);
      return false;
    }
  }
  const unsigned = path.join(work, "unsigned.apk");
  fs.copyFileSync(apk, unsigned);
  // Drop the old v1 signature files; apksigner writes new ones (exit 12: there were none).
  spawnSync("zip", ["-q", "-d", unsigned, "META-INF/*.SF", "META-INF/*.RSA", "META-INF/*.MF"], {
    cwd: work,
  });
  run("zip", ["-q", "-0", unsigned, "assets/index.android.bundle", ...images], { cwd: work });
  const tools = androidBuildTools();
  const aligned = path.join(work, "aligned.apk");
  run(path.join(tools, "zipalign"), ["-f", "-p", "4", unsigned, aligned]);
  const ks = path.join(os.homedir(), ".android", "debug.keystore");
  // The well-known debug keystore credentials, not a secret: the booth APK is debug-signed.
  run(path.join(tools, "apksigner"), [
    "sign",
    "--ks",
    ks,
    "--ks-pass",
    "pass:android",
    "--ks-key-alias",
    "androiddebugkey",
    "--key-pass",
    "pass:android",
    "--out",
    apk,
    aligned,
  ]);
  return true;
}

/**
 * A ready-to-install binary for this checkout from the cache, or null on a miss.
 * outDir receives the copy (default: <projectRoot>/build/cache-<platform>-<profile>).
 */
function resolve({ projectRoot, platform, fingerprint: fp, profile, outDir }) {
  const dir = entryDir(platform, fp, profile);
  const cached = cachedBinary(dir);
  if (!cached) return null;
  const now = new Date();
  fs.utimesSync(path.dirname(dir), now, now); // recently used: pruned last
  const out = outDir || path.join(projectRoot, "build", `cache-${platform}-${profile}`);
  const binary = path.join(out, platform === "ios" ? path.basename(cached) : `app-${profile}.apk`);
  cloneCopy(cached, binary);
  if (profile === "debug") return binary;
  if (platform === "ios") {
    swapIos(projectRoot, binary);
    return binary;
  }
  const work = path.join(out, "swap");
  fs.rmSync(work, { recursive: true, force: true });
  try {
    return swapAndroid(projectRoot, binary, work) ? binary : null;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

module.exports = {
  cacheRoot,
  cachedBinary,
  entryDir,
  fingerprint,
  parseFingerprintOutput,
  profileOf,
  prune,
  resolve,
  store,
};
