import { HOT_UPDATER_SERVER_VERSION, type Bundle } from "@hot-updater/server";
import { createMigrator } from "@hot-updater/server/db";
import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import type { S3Config } from "./config.ts";
import { createOtaHotUpdater, openDatabase, type OtaHotUpdater } from "./hot-updater.ts";
import { createS3Storage } from "./storage.ts";

const TOKEN = "test-token-0123456789abcdef0123456789abcdef";
const NIL = "00000000-0000-0000-0000-000000000000";
const FINGERPRINT = "11142b9062165fa48665f5efa095dd94e9e45eb0";
const BUNDLE_ID = "0199b0a0-0000-7000-8000-000000000001";

const s3: S3Config = {
  endpoint: "http://127.0.0.1:9000",
  publicEndpoint: "auto",
  region: "us-east-1",
  bucket: "hot-updater",
  accessKeyId: "test-access-key",
  secretAccessKey: "test-secret-key",
};

const bundle: Bundle = {
  id: BUNDLE_ID,
  platform: "ios",
  shouldForceUpdate: false,
  enabled: true,
  fileHash: "abc123",
  storageUri: `s3://hot-updater/production/ios/${BUNDLE_ID}/bundle.zip`,
  gitCommitHash: null,
  message: "test bundle",
  channel: "production",
  targetAppVersion: null,
  fingerprintHash: FINGERPRINT,
};

const fingerprintPath = (fingerprint: string) =>
  `/hot-updater/fingerprint/ios/${fingerprint}/production/${NIL}/${NIL}`;

let db: Kysely<object>;
let hotUpdater: OtaHotUpdater;

async function setup(s3Config: S3Config = s3) {
  db = openDatabase(":memory:");
  hotUpdater = createOtaHotUpdater({ db, storages: [createS3Storage(s3Config)] });
  // What `pnpm db:migrate` (hot-updater db migrate) runs.
  const migration = await createMigrator(hotUpdater).migrateToLatest({
    mode: "from-schema",
    updateSettings: true,
  });
  await migration.execute();
  return createApp({ hotUpdater, authToken: TOKEN });
}

afterEach(async () => {
  await db.destroy();
});

describe("management routes (/hot-updater/api/*)", () => {
  let app: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    app = await setup();
  });

  it("reject a request without a bearer token with 401", async () => {
    const res = await app.request("/hot-updater/api/bundles");
    expect(res.status).toBe(401);
  });

  it("reject a wrong bearer token with 401 and do not create the bundle", async () => {
    const res = await app.request("/hot-updater/api/bundles", {
      method: "POST",
      headers: { Authorization: "Bearer wrong-token", "Content-Type": "application/json" },
      body: JSON.stringify([bundle]),
    });
    expect(res.status).toBe(401);
    expect(await hotUpdater.getBundleById(BUNDLE_ID)).toBeNull();
  });

  it("serve the bundle list for the correct bearer token", async () => {
    await hotUpdater.insertBundle(bundle);
    const res = await app.request("/hot-updater/api/bundles", {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Bundle[] };
    expect(body.data.map((b) => b.id)).toEqual([BUNDLE_ID]);
  });

  it("are not reachable unauthenticated through a double-slash path", async () => {
    const res = await app.request("/hot-updater//api/bundles");
    expect(res.status).not.toBe(200);
  });
});

describe("device routes", () => {
  it("version route reports the hot-updater server version", async () => {
    const app = await setup();
    const res = await app.request("/hot-updater/version");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ version: HOT_UPDATER_SERVER_VERSION });
  });

  it("update check answers an unknown fingerprint with no update (null)", async () => {
    const app = await setup();
    await hotUpdater.insertBundle(bundle);
    const res = await app.request(fingerprintPath("0000000000000000000000000000000000000000"));
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
  });

  it("update check signs the download URL for the host the phone used (S3_PUBLIC_ENDPOINT=auto)", async () => {
    const app = await setup();
    await hotUpdater.insertBundle(bundle);
    const res = await app.request(fingerprintPath(FINGERPRINT), {
      headers: { Host: "192.168.1.20:3002" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; status: string; fileUrl: string };
    expect(body).toMatchObject({ id: BUNDLE_ID, status: "UPDATE" });
    const url = new URL(body.fileUrl);
    expect(url.origin).toBe("http://192.168.1.20:9000");
    expect(url.pathname).toBe(`/hot-updater/production/ios/${BUNDLE_ID}/bundle.zip`);
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("update check signs the download URL for a pinned S3_PUBLIC_ENDPOINT regardless of Host", async () => {
    const app = await setup({ ...s3, publicEndpoint: "http://10.0.0.5:9000" });
    await hotUpdater.insertBundle(bundle);
    const res = await app.request(fingerprintPath(FINGERPRINT), {
      headers: { Host: "localhost:3002" },
    });
    const body = (await res.json()) as { fileUrl: string };
    expect(new URL(body.fileUrl).origin).toBe("http://10.0.0.5:9000");
  });
});
