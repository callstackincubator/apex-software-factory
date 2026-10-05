#!/usr/bin/env node
"use strict";

const path = require("node:path");
const apps = require("./config.js");
const { checkApp } = require("./lib.js");

const root = path.resolve(__dirname, "../..");
let failed = false;
for (const app of apps) {
  for (const v of checkApp(root, app).violations) {
    failed = true;
    console.error(`${app.src}/${v.file}: "${v.spec}": ${v.message}`);
  }
}
process.exit(failed ? 1 : 0);
