import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.ts";

const minimal = {
  HOT_UPDATER_AUTH_TOKEN: "x".repeat(32),
  S3_ACCESS_KEY_ID: "apex-ota",
  S3_SECRET_ACCESS_KEY: "secret-secret",
};

describe("loadConfig", () => {
  it("defaults to 0.0.0.0:3002, local MinIO and per-request public endpoint", () => {
    const config = loadConfig(minimal);
    expect(config).toMatchObject({
      host: "0.0.0.0",
      port: 3002,
      s3: { endpoint: "http://127.0.0.1:9000", publicEndpoint: "auto", bucket: "hot-updater" },
    });
    expect(config.databasePath).toMatch(/apps\/ota-server\/data\/ota\.sqlite$/);
  });

  it("fails fast on a missing secret or a short auth token", () => {
    expect(() => loadConfig({ ...minimal, S3_SECRET_ACCESS_KEY: undefined })).toThrow(
      /S3_SECRET_ACCESS_KEY/,
    );
    expect(() => loadConfig({ ...minimal, HOT_UPDATER_AUTH_TOKEN: "short" })).toThrow(
      /HOT_UPDATER_AUTH_TOKEN/,
    );
  });

  it("rejects a public endpoint that is neither auto nor an http(s) URL", () => {
    expect(() => loadConfig({ ...minimal, S3_PUBLIC_ENDPOINT: "192.168.1.20:9000" })).toThrow(
      /S3_PUBLIC_ENDPOINT/,
    );
  });
});
