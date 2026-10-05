import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./config.ts";

describe("loadConfig", () => {
  it("defaults to port 4280 on 127.0.0.1 and no demo", () => {
    const config = loadConfig({}, []);

    expect(config).toMatchObject({ port: 4280, host: "127.0.0.1", demo: false });
    expect(config.repo).toBeUndefined();
    expect(config.opencodeDb).toMatch(/\.local\/share\/opencode\/opencode\.db$/);
  });

  it("refuses a host that is not loopback, naming the variable", () => {
    expect(() => loadConfig({ CONSOLE_HOST: "0.0.0.0" }, [])).toThrow(ConfigError);
    expect(() => loadConfig({ CONSOLE_HOST: "192.168.1.5" }, [])).toThrow(/CONSOLE_HOST/);
  });

  it("accepts localhost and ::1 as hosts", () => {
    expect(loadConfig({ CONSOLE_HOST: "localhost" }, []).host).toBe("localhost");
    expect(loadConfig({ CONSOLE_HOST: "::1" }, []).host).toBe("::1");
  });

  it("refuses a port that is not a port and a repo that is not owner/name", () => {
    expect(() => loadConfig({ CONSOLE_PORT: "99999" }, [])).toThrow(/CONSOLE_PORT/);
    expect(() => loadConfig({ CONSOLE_PORT: "abc" }, [])).toThrow(ConfigError);
    expect(() => loadConfig({ CONSOLE_REPO: "just-a-name" }, [])).toThrow(/CONSOLE_REPO/);
  });

  it("turns demo on from --demo or from CONSOLE_DEMO", () => {
    expect(loadConfig({}, ["--demo"]).demo).toBe(true);
    expect(loadConfig({ CONSOLE_DEMO: "1" }, []).demo).toBe(true);
    expect(loadConfig({ CONSOLE_DEMO: "0" }, []).demo).toBe(false);
  });

  it("splits FACTORY_RUN_LOGS on colons and leaves discovery to the caller without it", () => {
    expect(loadConfig({ FACTORY_RUN_LOGS: "/a/logs:/b/logs" }, []).runLogDirs).toEqual([
      "/a/logs",
      "/b/logs",
    ]);
    expect(loadConfig({}, []).runLogDirs).toBeUndefined();
  });

  it("lists every problem at once", () => {
    let message = "";
    try {
      loadConfig({ CONSOLE_HOST: "0.0.0.0", CONSOLE_PORT: "0" }, []);
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain("CONSOLE_HOST");
    expect(message).toContain("CONSOLE_PORT");
  });
});
