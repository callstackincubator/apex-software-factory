"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const apps = require("./config.js");
const { checkApp } = require("./lib.js");

const APP = {
  src: "src",
  alias: "@/",
  framework: ["react"],
  owners: { "@hot-updater/react-native": ["modules/updater/**"] },
};

function violationsIn(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apex-boundaries-"));
  try {
    for (const [name, text] of Object.entries(files)) {
      const file = path.join(root, "src", name);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
    }
    return checkApp(root, APP).violations.map((v) => `${v.file} -> ${v.spec}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("the apps in this repository keep every module boundary", () => {
  const root = path.resolve(__dirname, "../..");
  for (const app of apps) {
    const { files, violations } = checkApp(root, app);
    assert.ok(files > 0, `${app.src} has no source files`);
    assert.deepEqual(
      violations.map((v) => `${app.src}/${v.file}: "${v.spec}": ${v.message}`),
      [],
    );
  }
});

test("another module is reached only through its index", () => {
  assert.deepEqual(
    violationsIn({
      "modules/ota/banner.tsx": "export const Banner = 1;",
      "modules/ota/index.ts": 'export { Banner } from "./banner";',
      "modules/home/screen.tsx": [
        'import { Banner } from "@/modules/ota";',
        'import { Banner as B } from "@/modules/ota/banner";',
        'import { Banner as C } from "../ota/banner";',
        'const D = require("@/modules/ota/banner");',
        'jest.mock("@/modules/ota/banner");',
      ].join("\n"),
    }),
    [
      "modules/home/screen.tsx -> @/modules/ota/banner",
      "modules/home/screen.tsx -> ../ota/banner",
      "modules/home/screen.tsx -> @/modules/ota/banner",
      "modules/home/screen.tsx -> @/modules/ota/banner",
    ],
  );
});

test("a module imports its own files by relative path, not through the alias", () => {
  assert.deepEqual(
    violationsIn({
      "modules/ota/banner.tsx":
        'import { x } from "./control";\nimport { y } from "@/modules/ota";',
      "modules/ota/control.ts": "export const x = 1;",
    }),
    ["modules/ota/banner.tsx -> @/modules/ota"],
  );
});

test("a third-party package is imported only by the module that owns it", () => {
  assert.deepEqual(
    violationsIn({
      "modules/updater/hot-updater.ts": 'import { HotUpdater } from "@hot-updater/react-native";',
      "modules/ota/check.ts": [
        'import { useState } from "react";',
        'import { HotUpdater } from "@hot-updater/react-native";',
        'import { openDatabaseSync } from "expo-sqlite";',
      ].join("\n"),
      "modules/ota/__tests__/check.test.ts":
        'import { HotUpdater } from "@hot-updater/react-native";',
    }),
    ["modules/ota/check.ts -> @hot-updater/react-native", "modules/ota/check.ts -> expo-sqlite"],
  );
});
