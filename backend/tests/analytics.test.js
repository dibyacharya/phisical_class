/**
 * Analytics API Tests
 * Tests: fleet overview, trends, device history, alerts, peak hours, rankings, daily summary
 */
const request = require("supertest");
const { setupTestDb } = require("./testDb");
const createApp = require("./app");
const { createAdmin, createDevice } = require("./helpers");
const HealthSnapshot = require("../models/HealthSnapshot");

setupTestDb();
const app = createApp();

describe("Analytics API", () => {
  let adminToken, device;

  beforeEach(async () => {
    const admin = await createAdmin();
    adminToken = admin.token;
    device = await createDevice({ macAddress: "AN:AL:YT:IC:S0:01" });

    // Seed some health snapshots for analytics
    const now = new Date();
    const snapshots = [];
    for (let i = 0; i < 12; i++) {
      snapshots.push({
        deviceId: device.deviceId,
        deviceName: device.name,
        roomNumber: device.roomNumber,
        cpu: { usagePercent: 40 + Math.random() * 30, temperature: 48 + Math.random() * 10 },
        ram: { usedPercent: 55 + Math.random() * 20, freeGB: 0.5, totalGB: 2 },
        disk: { usedPercent: 30, freeGB: 5, totalGB: 8 },
        network: { wifiSignal: -55 - Math.random() * 20, latencyMs: 80 + Math.random() * 100 },
        camera: { ok: true },
        mic: { ok: true },
        screen: { ok: true, resolution: "1920x1080" },
        recording: { isRecording: i % 3 === 0, frameDrops: Math.floor(Math.random() * 3), errorCount: 0 },
        upload: { successCount: i, failCount: 0 },
        serviceUptime: 3600 * i,
        timestamp: new Date(now.getTime() - (12 - i) * 30 * 60 * 1000), // every 30 min
      });
    }
    await HealthSnapshot.insertMany(snapshots);
  });

  // ── Fleet Overview ──────────────────────────────────────────
  describe("GET /api/analytics/fleet-overview", () => {
    it("should return fleet overview with device counts", async () => {
      const res = await request(app)
        .get("/api/analytics/fleet-overview")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.total).toBeDefined();
      expect(res.body.online).toBeDefined();
      expect(res.body.devices).toBeDefined();
    });

    it("should require admin auth", async () => {
      await request(app)
        .get("/api/analytics/fleet-overview")
        .expect(401);
    });
  });

  // ── Fleet Trends ────────────────────────────────────────────
  describe("GET /api/analytics/trends", () => {
    it("should return hourly trend data", async () => {
      const res = await request(app)
        .get("/api/analytics/trends?days=1")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.trends).toBeDefined();
      expect(Array.isArray(res.body.trends)).toBe(true);
    });
  });

  // ── Device History ──────────────────────────────────────────
  describe("GET /api/analytics/device/:deviceId/history", () => {
    it("should return device-specific history", async () => {
      const res = await request(app)
        .get(`/api/analytics/device/${device.deviceId}/history?days=1`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.deviceId).toBe(device.deviceId);
      expect(res.body.history).toBeDefined();
    });
  });

  // ── Active Alerts ───────────────────────────────────────────
  describe("GET /api/analytics/alerts", () => {
    it("should return alerts array", async () => {
      const res = await request(app)
        .get("/api/analytics/alerts")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.alerts).toBeDefined();
      expect(Array.isArray(res.body.alerts)).toBe(true);
    });
  });

  // ── Peak Hours ──────────────────────────────────────────────
  describe("GET /api/analytics/peak-hours", () => {
    it("should return peak hours data", async () => {
      const res = await request(app)
        .get("/api/analytics/peak-hours?days=1")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.hours).toBeDefined();
    });
  });

  // ── Device Ranking ──────────────────────────────────────────
  describe("GET /api/analytics/device-ranking", () => {
    it("should return ranked devices", async () => {
      const res = await request(app)
        .get("/api/analytics/device-ranking?days=7")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.devices).toBeDefined();
    });
  });

  // ── Daily Summary ───────────────────────────────────────────
  describe("GET /api/analytics/daily-summary", () => {
    it("should return daily summary data", async () => {
      const res = await request(app)
        .get("/api/analytics/daily-summary?days=7")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.dailyData).toBeDefined();
    });
  });
});
