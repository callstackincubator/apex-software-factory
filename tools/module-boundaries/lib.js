"use strict";

const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const SOURCE = /\.(ts|tsx|js|jsx)$/;
const TEST = /(^|\/)__tests__\/|\.test\.(ts|tsx|js)$/;

function listFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(full);
    return SOURCE.test(entry.name) ? [full] : [];
  });
}

function specifiers(source) {
  const found = ts.preProcessFile(source, true, true).importedFiles.map((f) => f.fileName);
  for (const match of source.matchAll(
    /jest\.(?:mock|doMock|requireActual)\(\s*["']([^"']+)["']/g,
  )) {
    found.push(match[1]);
  }
  return found;
}

function globToRegExp(glob) {
  const body = glob
    .split("**")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", "[^/]*"))
    .join(".*");
  return new RegExp(`^${body}$`);
}

function packageName(spec) {
  if (spec.startsWith("node:")) return spec;
  const parts = spec.split("/");
  return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

function matchesPackage(pattern, name) {
  if (pattern === "*") return true;
  if (pattern.endsWith("/*")) return name.startsWith(pattern.slice(0, -1));
  return pattern === name;
}

function moduleOf(rel) {
  const parts = rel.split("/");
  return parts[0] === "modules" && parts.length > 2 ? parts[1] : null;
}

function internalTarget(rel) {
  const bare = rel.replace(SOURCE, "").replace(/\/index$/, "");
  const parts = bare.split("/");
  if (parts[0] !== "modules" || parts.length < 2) return null;
  return { module: parts[1], entry: parts.length === 2 };
}

function checkFile(app, srcDir, file) {
  const rel = path.relative(srcDir, file).split(path.sep).join("/");
  const own = moduleOf(rel);
  const isTest = TEST.test(rel);
  const violations = [];
  const report = (spec, message) => violations.push({ file: rel, spec, message });

  for (const spec of specifiers(fs.readFileSync(file, "utf8"))) {
    const viaAlias = app.alias !== null && spec.startsWith(app.alias);
    if (viaAlias || spec.startsWith(".")) {
      const resolved = viaAlias
        ? path.join(srcDir, spec.slice(app.alias.length))
        : path.resolve(path.dirname(file), spec);
      const target = internalTarget(path.relative(srcDir, resolved).split(path.sep).join("/"));
      if (!target) continue;
      if (target.module === own) {
        if (viaAlias) report(spec, "inside a module, import its own files by relative path");
      } else if (!target.entry) {
        report(spec, `deep import: use the public API, modules/${target.module}/index.ts`);
      }
      continue;
    }
    if (isTest) continue;
    const name = packageName(spec);
    if (app.framework.some((pattern) => matchesPackage(pattern, name))) continue;
    const owners = Object.entries(app.owners)
      .filter(([pattern]) => matchesPackage(pattern, name))
      .flatMap(([, globs]) => globs);
    if (owners.some((glob) => globToRegExp(glob).test(rel))) continue;
    report(
      spec,
      owners.length > 0
        ? `third-party API: only ${owners.join(", ")} may import ${name}`
        : `third-party API with no port module: add one, and list it in tools/module-boundaries/config.js`,
    );
  }
  return violations;
}

function checkApp(root, app) {
  const srcDir = path.join(root, app.src);
  const files = listFiles(srcDir);
  return {
    files: files.length,
    violations: files.flatMap((file) => checkFile(app, srcDir, file)),
  };
}

module.exports = { checkApp };
