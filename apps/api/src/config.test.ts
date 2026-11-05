import { describe, expect, it } from "vitest";
import packageJson from "../package.json" with { type: "json" };
import { ConfigError, loadConfig, loadNodeConfig } from "./config.ts";

describe("loadNodeConfig", () => {
  it("defaults to port 3001 on all interfaces so LAN phones can connect", () => {
    const config = loadNodeConfig({});

    expect(config.port).toBe(3001);
    expect(config.host).toBe("0.0.0.0");
  });

  it.each(["abc", "0", "70000", "30.5"])("rejects PORT=%s with a message naming PORT", (port) => {
    expect(() => loadNodeConfig({ PORT: port })).toThrow(ConfigError);
    expect(() => loadNodeConfig({ PORT: port })).toThrow(/PORT/);
  });
});

describe("loadConfig", () => {
  it("takes the version from package.json when APP_VERSION is unset", () => {
    expect(loadConfig({}).appVersion).toBe(packageJson.version);
    expect(loadConfig({ APP_VERSION: "2.0.0" }).appVersion).toBe("2.0.0");
  });

  it("rejects an unknown LOG_LEVEL", () => {
    expect(() => loadConfig({ LOG_LEVEL: "loud" })).toThrow(/LOG_LEVEL/);
  });

  it("ignores the Node-only settings, so a Worker binding named PORT cannot break it", () => {
    expect(loadConfig({ PORT: "abc" })).toEqual({
      logLevel: "info",
      appVersion: packageJson.version,
    });
  });
});
