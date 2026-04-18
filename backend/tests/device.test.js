/**
 * Device Registration, Heartbeat, Health Report Tests
 * Tests: register, heartbeat, health-report, force-start/stop, schedule delivery
 */
const request = require("supertest");
const { setupTestDb } = require("./testDb");
const createApp = require("./app");
const { createAdmin, createDevice, createLicense, createScheduledClass } = require("./helpers");
const DeviceCommand = require("../models/DeviceCommand");
const ClassroomDevice = require("../models/ClassroomDevice");

setupTestDb();
const app = createApp();

describe("Device API", () => {
  // ── Registration ────────────────────────────────────────────
  describe("POST /api/classroom-recording/devices/register", () => {
    it("should register a new device with valid license key", async () => {
      const license = await createLicense();
      const res = await request(app)
        .post("/api/classroom-recording/devices/register")
        .send({
          name: "Smart TV - R101",
          roomNumber: "R101",
          macAddress: "AA:BB:CC:DD:EE:01",
          deviceType: "android",
          deviceModel: "Amlogic S905X",
          licenseKey: license.key,
        })
        .expect(200);

      expect(res.body.setupConfig).toBeDefined();
      expect(res.body.setupConfig.deviceId).toBeDefined();
      expect(res.body.setupConfig.authToken).toBeDefined();
    });

    it("should reject registration without license key", async () => {
      const res = await request(app)
        .post("/api/classroom-recording/devices/register")
        .send({
          name: "Smart TV",
          roomNumber: "R101",
          macAddress: "AA:BB:CC:DD:EE:02",
        })
        .expect(403);

      expect(res.body.error).toMatch(/license/i);
    });

    it("should reject invalid license key", async () => {
      const res = await request(app)
        .post("/api/classroom-recording/devices/register")
        .send({
          name: "Smart TV",
          roomNumber: "R101",
          macAddress: "AA:BB:CC:DD:EE:03",
          licenseKey: "INVALID-KEY",
        })
        .expect(404);

      expect(res.body.error).toMatch(/invalid/i);
    });

    it("should allow re-registration with same MAC address (no license needed)", async () => {
      const license = await createLicense();
      // First registration
      await request(app)
        .post("/api/classroom-recording/devices/register")
        .send({
          name: "Smart TV",
          roomNumber: "R101",
          macAddress: "AA:BB:CC:DD:EE:04",
          licenseKey: license.key,
          spaceCode: "C25-BA-F3-R101",
        })
        .expect(200);

      // Re-registration (same MAC, same room — update device info)
      const res = await request(app)
        .post("/api/classroom-recording/devices/register")
        .send({
          name: "Smart TV Updated",
          roomNumber: "R101",
          macAddress: "AA:BB:CC:DD:EE:04",
          spaceCode: "C25-BA-F3-R101",
        })
        .expect(200);

      expect(res.body.setupConfig.deviceId).toBeDefined();
    });

    it("should reject already-activated license on different device", async () => {
      const license = await createLicense();
      // First device
      await request(app)
        .post("/api/classroom-recording/devices/register")
        .send({
          roomNumber: "R101",
          macAddress: "AA:BB:CC:DD:EE:05",
          licenseKey: license.key,
        });

      // Second device with same license
      const res = await request(app)
        .post("/api/classroom-recording/devices/register")
        .send({
          roomNumber: "R102",
          macAddress: "FF:FF:FF:FF:FF:FF",
          licenseKey: license.key,
        })
        .expect(409);

      expect(res.body.error).toMatch(/already activated/i);
    });

    it("should require roomNumber", async () => {
      await request(app)
        .post("/api/classroom-recording/devices/register")
        .send({ macAddress: "AA:BB:CC:DD:EE:06" })
        .expect(400);
    });

    it("should require macAddress", async () => {
      await request(app)
        .post("/api/classroom-recording/devices/register")
        .send({ roomNumber: "R101" })
        .expect(400);
    });
  });

  // ── Heartbeat ───────────────────────────────────────────────
  describe("POST /api/classroom-recording/devices/:deviceId/heartbeat", () => {
    it("should accept heartbeat with valid device credentials", async () => {
      const device = await createDevice();
      const res = await request(app)
        .post(`/api/classroom-recording/devices/${device.deviceId}/heartbeat`)
        .set("x-device-id", device.deviceId)
        .set("x-device-token", device.authToken)
        .send({ ipAddress: "192.168.1.100", isRecording: false })
        .expect(200);

      expect(res.body.schedule).toBeDefined();
      expect(res.body.serverTime).toBeDefined();
    });

    it("should reject heartbeat without device auth", async () => {
      const device = await createDevice();
      await request(app)
        .post(`/api/classroom-recording/devices/${device.deviceId}/heartbeat`)
        .send({})
        .expect(401);
    });

    it("should reject heartbeat with wrong token", async () => {
      const device = await createDevice();
      await request(app)
        .post(`/api/classroom-recording/devices/${device.deviceId}/heartbeat`)
        .set("x-device-id", device.deviceId)
        .set("x-device-token", "wrong-token")
        .send({})
        .expect(401);
    });

    it("should return today's schedule in heartbeat", async () => {
      const device = await createDevice({ roomNumber: "R101" });
      await createScheduledClass({ roomNumber: "R101" });

      const res = await request(app)
        .post(`/api/classroom-recording/devices/${device.deviceId}/heartbeat`)
        .set("x-device-id", device.deviceId)
        .set("x-device-token", device.authToken)
        .send({})
        .expect(200);

      expect(res.body.schedule.length).toBe(1);
      expect(res.body.schedule[0].title).toBe("Test Lecture");
    });

    it("should deliver pending commands in heartbeat response", async () => {
      const device = await createDevice();
      await DeviceCommand.create({
        deviceId: device.deviceId,
        command: "capture_screenshot",
        issuedBy: "admin",
      });

      const res = await request(app)
        .post(`/api/classroom-recording/devices/${device.deviceId}/heartbeat`)
        .set("x-device-id", device.deviceId)
        .set("x-device-token", device.authToken)
        .send({})
        .expect(200);

      expect(res.body.commands.length).toBe(1);
      expect(res.body.commands[0].command).toBe("capture_screenshot");
    });

    it("should accept inline health data", async () => {
      const device = await createDevice();
      const res = await request(app)
        .post(`/api/classroom-recording/devices/${device.deviceId}/heartbeat`)
        .set("x-device-id", device.deviceId)
        .set("x-device-token", device.authToken)
        .send({
          health: {
            cpu: { usagePercent: 45, temperature: 52 },
            ram: { usedPercent: 60, freeGB: 0.8, totalGB: 2 },
            disk: { usedPercent: 30, freeGB: 5, totalGB: 8 },
          },
        })
        .expect(200);

      // Verify health was saved
      const updated = await ClassroomDevice.findOne({ deviceId: device.deviceId });
      expect(updated.health.cpu.usagePercent).toBe(45);
    });

    it("should reset isRecording when device signals stop", async () => {
      const device = await createDevice();
      device.isRecording = true;
      device.currentMeetingId = "meeting123";
      await device.save();

      await request(app)
        .post(`/api/classroom-recording/devices/${device.deviceId}/heartbeat`)
        .set("x-device-id", device.deviceId)
        .set("x-device-token", device.authToken)
        .send({ isRecording: false })
        .expect(200);

      const updated = await ClassroomDevice.findOne({ deviceId: device.deviceId });
      expect(updated.isRecording).toBe(false);
      expect(updated.currentMeetingId).toBeNull();
    });
  });

  // ── Health Report ───────────────────────────────────────────
  describe("POST /api/classroom-recording/devices/:deviceId/health-report", () => {
    it("should save health report with alerts", async () => {
      const device = await createDevice();
      const res = await request(app)
        .post(`/api/classroom-recording/devices/${device.deviceId}/health-report`)
        .set("x-device-id", device.deviceId)
        .set("x-device-token", device.authToken)
        .send({
          camera: { ok: true, name: "Camera 0" },
          mic: { ok: false, error: "Microphone not detected" },
          disk: { freeGB: 0.5, totalGB: 8, usedPercent: 94 },
          cpu: { usagePercent: 75 },
          ram: { usedPercent: 85, freeGB: 0.3, totalGB: 2 },
          network: { wifiSignal: -65, latencyMs: 150 },
          screen: { ok: true, resolution: "1920x1080" },
        })
        .expect(200);

      expect(res.body.ok).toBe(true);

      // Check alerts were generated
      const updated = await ClassroomDevice.findOne({ deviceId: device.deviceId });
      const alertTypes = updated.health.alerts.map(a => a.type);
      expect(alertTypes).toContain("mic");
      expect(alertTypes).toContain("disk");
    });
  });

  // ── Force Start/Stop (now uses command queue) ───────────────
  describe("POST /api/classroom-recording/devices/:deviceId/force-start", () => {
    it("should queue force_start command (admin only)", async () => {
      const { token } = await createAdmin();
      const device = await createDevice();

      const res = await request(app)
        .post(`/api/classroom-recording/devices/${device.deviceId}/force-start`)
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      expect(res.body.commandId).toBeDefined();

      // Verify command was created in queue
      const cmd = await DeviceCommand.findById(res.body.commandId);
      expect(cmd.command).toBe("force_start");
      expect(cmd.status).toBe("pending");
    });
  });

  describe("POST /api/classroom-recording/devices/:deviceId/force-stop", () => {
    it("should queue force_stop command (admin only)", async () => {
      const { token } = await createAdmin();
      const device = await createDevice();

      const res = await request(app)
        .post(`/api/classroom-recording/devices/${device.deviceId}/force-stop`)
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      expect(res.body.commandId).toBeDefined();

      const cmd = await DeviceCommand.findById(res.body.commandId);
      expect(cmd.command).toBe("force_stop");
    });
  });

  // ── Device List ─────────────────────────────────────────────
  describe("GET /api/classroom-recording/devices", () => {
    it("should return list of active devices (admin only)", async () => {
      const { token } = await createAdmin();
      await createDevice({ macAddress: "11:22:33:44:55:01" });
      await createDevice({ macAddress: "11:22:33:44:55:02", name: "TV 2" });

      const res = await request(app)
        .get("/api/classroom-recording/devices")
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      expect(res.body.length).toBe(2);
    });
  });

  // ── Dashboard ───────────────────────────────────────────────
  describe("GET /api/classroom-recording/dashboard", () => {
    it("should return dashboard stats", async () => {
      const { token } = await createAdmin();
      await createDevice({ macAddress: "DA:SH:BO:AR:D1:01" });

      const res = await request(app)
        .get("/api/classroom-recording/dashboard")
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      expect(res.body.totalDevices).toBe(1);
      expect(res.body.totalRecordings).toBeDefined();
    });
  });
});
