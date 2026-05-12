/**
 * Storage config endpoints — covers the v2.2.x R2 migration plus the
 * v2.1.x Azure fallback path.
 *
 * Endpoints under test:
 *   GET /api/windows/devices/r2-config   (windowsDeviceAuth)
 *   GET /api/windows/devices/blob-config (windowsDeviceAuth — legacy)
 *
 * Invariants:
 *   - /r2-config returns 503 when R2_* env vars not set (device falls
 *     through to /blob-config for in-flight v2.1.x compat)
 *   - /r2-config returns full creds when env set; endpoint URL is
 *     derived from R2_ACCOUNT_ID if R2_ENDPOINT is missing
 *   - /blob-config returns 503 when AZURE_STORAGE_CONNECTION_STRING
 *     is missing (default since v2.2.0 — Railway env is R2-only now)
 *   - both endpoints require valid windowsDeviceAuth headers
 */

const request = require("supertest");
const { setupTestDb } = require("./testDb");
const createApp = require("./app");
const { createWindowsDevice } = require("./helpers");

setupTestDb();
const app = createApp();

// Helper: snapshot + restore env between tests so we can mutate freely.
function withEnv(overrides, run) {
  const keys = [
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET",
    "R2_PUBLIC_URL",
    "R2_ENDPOINT",
    "R2_PATH_PREFIX",
    "AZURE_STORAGE_CONNECTION_STRING",
    "AZURE_STORAGE_CONTAINER",
    "AZURE_BLOB_PREFIX",
  ];
  const saved = {};
  for (const k of keys) saved[k] = process.env[k];
  // Clear all, then apply overrides
  for (const k of keys) delete process.env[k];
  Object.assign(process.env, overrides);
  return run().finally(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });
}

describe("GET /api/windows/devices/r2-config", () => {
  it("returns 503 when R2_* env vars not configured", async () => {
    const device = await createWindowsDevice();
    await withEnv({}, async () => {
      const res = await request(app)
        .get("/api/windows/devices/r2-config")
        .set("X-Device-Id", device.deviceId)
        .set("X-Device-Token", device.authToken)
        .expect(503);
      expect(res.body.error).toMatch(/R2 not configured/i);
      expect(res.body.present).toBeDefined();
      expect(res.body.present.accessKeyId).toBe(false);
    });
  });

  it("returns full credentials when env vars set", async () => {
    const device = await createWindowsDevice();
    await withEnv(
      {
        R2_ACCOUNT_ID: "57eacfa5238a05bd3d8ff4c8369a2f25",
        R2_ACCESS_KEY_ID: "test-access-key",
        R2_SECRET_ACCESS_KEY: "test-secret-key",
        R2_BUCKET: "lecturelens-recordings",
        R2_PUBLIC_URL: "https://pub-abc123.r2.dev",
        R2_ENDPOINT: "https://57eacfa5238a05bd3d8ff4c8369a2f25.r2.cloudflarestorage.com",
      },
      async () => {
        const res = await request(app)
          .get("/api/windows/devices/r2-config")
          .set("X-Device-Id", device.deviceId)
          .set("X-Device-Token", device.authToken)
          .expect(200);

        expect(res.body.accountId).toBe("57eacfa5238a05bd3d8ff4c8369a2f25");
        expect(res.body.accessKeyId).toBe("test-access-key");
        expect(res.body.secretAccessKey).toBe("test-secret-key");
        expect(res.body.bucket).toBe("lecturelens-recordings");
        expect(res.body.publicUrl).toBe("https://pub-abc123.r2.dev");
        expect(res.body.endpoint).toBe(
          "https://57eacfa5238a05bd3d8ff4c8369a2f25.r2.cloudflarestorage.com"
        );
        // pathPrefix has a default
        expect(res.body.pathPrefix).toBe("physical-class-recordings");
      }
    );
  });

  it("derives endpoint from accountId when R2_ENDPOINT not set", async () => {
    const device = await createWindowsDevice();
    await withEnv(
      {
        R2_ACCOUNT_ID: "abc123",
        R2_ACCESS_KEY_ID: "k",
        R2_SECRET_ACCESS_KEY: "s",
        R2_BUCKET: "b",
        // R2_ENDPOINT missing on purpose
      },
      async () => {
        const res = await request(app)
          .get("/api/windows/devices/r2-config")
          .set("X-Device-Id", device.deviceId)
          .set("X-Device-Token", device.authToken)
          .expect(200);
        expect(res.body.endpoint).toBe("https://abc123.r2.cloudflarestorage.com");
      }
    );
  });

  it("rejects without device auth (401)", async () => {
    await withEnv(
      {
        R2_ACCESS_KEY_ID: "k",
        R2_SECRET_ACCESS_KEY: "s",
        R2_BUCKET: "b",
        R2_ENDPOINT: "https://x.r2.cloudflarestorage.com",
      },
      async () => {
        await request(app)
          .get("/api/windows/devices/r2-config")
          .expect(401);
      }
    );
  });

  it("rejects with wrong device token", async () => {
    const device = await createWindowsDevice();
    await withEnv(
      {
        R2_ACCESS_KEY_ID: "k",
        R2_SECRET_ACCESS_KEY: "s",
        R2_BUCKET: "b",
        R2_ENDPOINT: "https://x.r2.cloudflarestorage.com",
      },
      async () => {
        await request(app)
          .get("/api/windows/devices/r2-config")
          .set("X-Device-Id", device.deviceId)
          .set("X-Device-Token", "wrong-token-aaaa")
          .expect(401);
      }
    );
  });
});

describe("GET /api/windows/devices/blob-config (legacy Azure)", () => {
  it("returns 503 when AZURE_STORAGE_CONNECTION_STRING not set (default since v2.2.0)", async () => {
    const device = await createWindowsDevice();
    await withEnv({}, async () => {
      const res = await request(app)
        .get("/api/windows/devices/blob-config")
        .set("X-Device-Id", device.deviceId)
        .set("X-Device-Token", device.authToken)
        .expect(503);
      expect(res.body.error).toMatch(/azure blob not configured/i);
    });
  });

  it("returns the connection string when env is set (for back-compat fleet)", async () => {
    const device = await createWindowsDevice();
    await withEnv(
      {
        AZURE_STORAGE_CONNECTION_STRING:
          "DefaultEndpointsProtocol=https;AccountName=test;AccountKey=dGVzdGtleQ==;EndpointSuffix=core.windows.net",
        AZURE_STORAGE_CONTAINER: "lms-storage",
      },
      async () => {
        const res = await request(app)
          .get("/api/windows/devices/blob-config")
          .set("X-Device-Id", device.deviceId)
          .set("X-Device-Token", device.authToken)
          .expect(200);
        expect(res.body.connectionString).toContain("AccountName=test");
        expect(res.body.container).toBe("lms-storage");
        // Default prefix when AZURE_BLOB_PREFIX not set
        expect(res.body.pathPrefix).toBe("physical-class-recordings");
      }
    );
  });
});
