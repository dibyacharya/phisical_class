/**
 * Remote Management Tests
 * Tests: command queue, thumbnails, logs, device ownership authorization
 */
const request = require("supertest");
const { setupTestDb } = require("./testDb");
const createApp = require("./app");
const { createAdmin, createDevice } = require("./helpers");
const DeviceCommand = require("../models/DeviceCommand");
const DeviceThumbnail = require("../models/DeviceThumbnail");
const DeviceLog = require("../models/DeviceLog");

setupTestDb();
const app = createApp();

describe("Remote Management API", () => {
  let adminToken, device, device2;

  beforeEach(async () => {
    const admin = await createAdmin();
    adminToken = admin.token;
    device = await createDevice({ macAddress: "RE:MO:TE:01:01:01" });
    device2 = await createDevice({ macAddress: "RE:MO:TE:02:02:02", name: "Device 2" });
  });

  // ── Admin: Send Command ─────────────────────────────────────
  describe("POST /api/remote/command (admin)", () => {
    it("should queue a command for a device", async () => {
      const res = await request(app)
        .post("/api/remote/command")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ deviceId: device.deviceId, command: "capture_screenshot" })
        .expect(201);

      expect(res.body.command).toBeDefined();
      expect(res.body.command.status).toBe("pending");
    });

    it("should reject without deviceId or command", async () => {
      await request(app)
        .post("/api/remote/command")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ deviceId: device.deviceId })
        .expect(400);
    });

    it("should reject non-admin users", async () => {
      const { token: studentToken } = await require("./helpers").createStudent({
        email: "stu-remote@test.com",
      });
      await request(app)
        .post("/api/remote/command")
        .set("Authorization", `Bearer ${studentToken}`)
        .send({ deviceId: device.deviceId, command: "reboot" })
        .expect(403);
    });
  });

  // ── Admin: Get Command History ──────────────────────────────
  describe("GET /api/remote/commands/:deviceId (admin)", () => {
    it("should return command history for a device", async () => {
      await DeviceCommand.create({ deviceId: device.deviceId, command: "reboot", issuedBy: "admin" });
      await DeviceCommand.create({ deviceId: device.deviceId, command: "pull_logs", issuedBy: "admin" });

      const res = await request(app)
        .get(`/api/remote/commands/${device.deviceId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.length).toBe(2);
    });
  });

  // ── Admin: Get Thumbnails ───────────────────────────────────
  describe("GET /api/remote/thumbnails/:deviceId (admin)", () => {
    it("should return thumbnails for a device", async () => {
      await DeviceThumbnail.create({
        deviceId: device.deviceId,
        imageData: "base64data",
        imageSize: 100,
      });

      const res = await request(app)
        .get(`/api/remote/thumbnails/${device.deviceId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.length).toBe(1);
    });
  });

  // ── Admin: Get Latest Thumbnail ─────────────────────────────
  describe("GET /api/remote/thumbnails/:deviceId/latest (admin)", () => {
    it("should return latest thumbnail", async () => {
      await DeviceThumbnail.create({
        deviceId: device.deviceId,
        imageData: "old",
        imageSize: 100,
        timestamp: new Date(Date.now() - 60000),
      });
      await DeviceThumbnail.create({
        deviceId: device.deviceId,
        imageData: "latest",
        imageSize: 200,
      });

      const res = await request(app)
        .get(`/api/remote/thumbnails/${device.deviceId}/latest`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.imageData).toBe("latest");
    });

    it("should return 404 when no thumbnails", async () => {
      await request(app)
        .get(`/api/remote/thumbnails/${device.deviceId}/latest`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(404);
    });
  });

  // ── Admin: Get Logs ─────────────────────────────────────────
  describe("GET /api/remote/logs/:deviceId (admin)", () => {
    it("should return logs for a device", async () => {
      await DeviceLog.create({
        deviceId: device.deviceId,
        deviceName: "Test TV",
        logText: "some logcat output",
        lineCount: 10,
        trigger: "manual",
      });

      const res = await request(app)
        .get(`/api/remote/logs/${device.deviceId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.length).toBe(1);
      expect(res.body[0].logText).toBe("some logcat output");
    });
  });

  // ════════════════════════════════════════════════════════════
  // DEVICE ENDPOINTS + AUTHORIZATION
  // ════════════════════════════════════════════════════════════

  // ── Device: Report Command Result ───────────────────────────
  describe("POST /api/remote/device/:deviceId/command-result", () => {
    it("should report command completion", async () => {
      const cmd = await DeviceCommand.create({
        deviceId: device.deviceId,
        command: "pull_logs",
        issuedBy: "admin",
      });

      const res = await request(app)
        .post(`/api/remote/device/${device.deviceId}/command-result`)
        .set("x-device-id", device.deviceId)
        .set("x-device-token", device.authToken)
        .send({ commandId: cmd._id.toString(), status: "completed", result: "Logs uploaded" })
        .expect(200);

      expect(res.body.ok).toBe(true);

      const updated = await DeviceCommand.findById(cmd._id);
      expect(updated.status).toBe("completed");
    });

    it("should BLOCK device from reporting another device's command", async () => {
      const cmd = await DeviceCommand.create({
        deviceId: device2.deviceId,  // belongs to device2
        command: "reboot",
        issuedBy: "admin",
      });

      // device1 tries to report device2's command
      const res = await request(app)
        .post(`/api/remote/device/${device.deviceId}/command-result`)
        .set("x-device-id", device.deviceId)
        .set("x-device-token", device.authToken)
        .send({ commandId: cmd._id.toString(), status: "completed", result: "hijacked" })
        .expect(403);

      expect(res.body.error).toMatch(/does not belong/i);
    });
  });

  // ── Device: Upload Thumbnail ────────────────────────────────
  describe("POST /api/remote/device/:deviceId/thumbnail", () => {
    it("should accept thumbnail upload", async () => {
      const res = await request(app)
        .post(`/api/remote/device/${device.deviceId}/thumbnail`)
        .set("x-device-id", device.deviceId)
        .set("x-device-token", device.authToken)
        .send({ imageData: "base64jpegdata", audioLevel: -45.5 })
        .expect(200);

      expect(res.body.ok).toBe(true);

      const thumb = await DeviceThumbnail.findOne({ deviceId: device.deviceId });
      expect(thumb).not.toBeNull();
      expect(thumb.audioLevel).toBeCloseTo(-45.5);
    });

    it("should require imageData", async () => {
      await request(app)
        .post(`/api/remote/device/${device.deviceId}/thumbnail`)
        .set("x-device-id", device.deviceId)
        .set("x-device-token", device.authToken)
        .send({})
        .expect(400);
    });
  });

  // ── Device: Upload Logs ─────────────────────────────────────
  describe("POST /api/remote/device/:deviceId/logs", () => {
    it("should accept logcat upload", async () => {
      const res = await request(app)
        .post(`/api/remote/device/${device.deviceId}/logs`)
        .set("x-device-id", device.deviceId)
        .set("x-device-token", device.authToken)
        .send({ logText: "E/RecorderService: Test error\nI/RecorderService: OK", trigger: "manual" })
        .expect(200);

      expect(res.body.ok).toBe(true);
    });

    it("should require logText", async () => {
      await request(app)
        .post(`/api/remote/device/${device.deviceId}/logs`)
        .set("x-device-id", device.deviceId)
        .set("x-device-token", device.authToken)
        .send({})
        .expect(400);
    });
  });

  // ── CRITICAL: Device ownership enforcement ──────────────────
  describe("Device ownership authorization (BUG #24 fix)", () => {
    it("should BLOCK device-A from accessing device-B's thumbnails endpoint", async () => {
      // device1 tries to upload thumbnail to device2's endpoint
      const res = await request(app)
        .post(`/api/remote/device/${device2.deviceId}/thumbnail`)
        .set("x-device-id", device.deviceId)     // device1's credentials
        .set("x-device-token", device.authToken)  // device1's token
        .send({ imageData: "malicious" })
        .expect(403);

      expect(res.body.error).toMatch(/mismatch/i);
    });

    it("should BLOCK device-A from uploading logs to device-B", async () => {
      const res = await request(app)
        .post(`/api/remote/device/${device2.deviceId}/logs`)
        .set("x-device-id", device.deviceId)
        .set("x-device-token", device.authToken)
        .send({ logText: "fake logs" })
        .expect(403);
    });
  });
});
