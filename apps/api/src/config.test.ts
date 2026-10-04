import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./config.ts";

describe("loadConfig", () => {
  it("defaults to port 3001 on all interfaces so LAN phones can connect", () => {
    const config = loadConfig({});

    expect(config.port).toBe(3001);
    expect(config.host).toBe("0.0.0.0");
  });

  it("takes the version from package.json when APP_VERSION is unset", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

    expect(loadConfig({}).appVersion).toBe(pkg.version);
    expect(loadConfig({ APP_VERSION: "2.0.0" }).appVersion).toBe("2.0.0");
  });

  it.each(["abc", "0", "70000", "30.5"])("rejects PORT=%s with a message naming PORT", (port) => {
    expect(() => loadConfig({ PORT: port })).toThrow(ConfigError);
    expect(() => loadConfig({ PORT: port })).toThrow(/PORT/);
  });

  it("rejects an unknown LOG_LEVEL", () => {
    expect(() => loadConfig({ LOG_LEVEL: "loud" })).toThrow(/LOG_LEVEL/);
  });
});
