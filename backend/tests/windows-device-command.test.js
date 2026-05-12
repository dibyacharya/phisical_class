/**
 * Windows device command endpoints — regression coverage for the v2.1.x
 * CastError bug.
 *
 * Bug summary: every device-card command button (Stop Recording, pull_logs,
 * capture_screenshot, restart_service, Delete) failed with HTTP 500 because
 * the four endpoints under /api/windows/devices/:id used
 *   { $or: [{ _id: req.params.id }, { deviceId: req.params.id }] }
 * directly. Under Mongoose 8 strict mode, when req.params.id is a deviceId
 * like "win_057d6f2f90b16806" (not a 24-char ObjectId), the `_id` clause
 * synchronously throws CastError and the controller's catch returned 500.
 *
 * Fix (commit 7b3c47c): extracted a deviceLookupOr() helper that only
 * adds the `_id` clause when the param actually parses as an ObjectId.
 *
 * Tests here lock in:
 *   - issueCommand works with deviceId (the failing case before fix)
 *   - issueCommand works with Mongo _id (was already working)
 *   - issueCommand 404s cleanly for unknown deviceId
 *   - listCommands, get, deregister behave the same way
 *   - All commands listed in CommandProcessor.cs are accepted by the
 *     schema enum (v2.1.3 expansion — five missing commands added)
 */

const request = require("supertest");
const { setupTestDb } = require("./testDb");
const createApp = require("./app");
const { createAdmin, createWindowsDevice } = require("./helpers");
const WindowsDeviceCommand = require("../models/windows/WindowsDeviceCommand");

setupTestDb();
const app = createApp();

describe("Windows device commands (issueCommand)", () => {
  // ── Issue ─────────────────────────────────────────────────────────────
  describe("POST /api/windows/devices/:id/command", () => {
    it("accepts a deviceId string (NOT a Mongo ObjectId) — regression for CastError bug", async () => {
      const { token } = await createAdmin();
      const device = await createWindowsDevice({ deviceId: "win_057d6f2f90b16806" });

      const res = await request(app)
        .post(`/api/windows/devices/${device.deviceId}/command`)
        .set("Authorization", `Bearer ${token}`)
        .send({ command: "stop_recording", params: {} })
        .expect(201);

      expect(res.body.message).toBe("Command queued");
      expect(res.body.command).toBeDefined();
      expect(res.body.command.deviceId).toBe(device.deviceId);
      expect(res.body.command.command).toBe("stop_recording");

      // Verify it was persisted
      const queued = await WindowsDeviceCommand.findOne({ deviceId: device.deviceId });
      expect(queued).toBeTruthy();
      expect(queued.status).toBe("pending");
    });

    it("accepts a Mongo _id (24-char hex) as :id", async () => {
      const { token } = await createAdmin();
      const device = await createWindowsDevice();

      const res = await request(app)
        .post(`/api/windows/devices/${device._id}/command`)
        .set("Authorization", `Bearer ${token}`)
        .send({ command: "pull_logs", params: {} })
        .expect(201);

      expect(res.body.command.deviceId).toBe(device.deviceId);
    });

    it("returns 404 (not 500) when :id matches nothing", async () => {
      const { token } = await createAdmin();
      const res = await request(app)
        .post(`/api/windows/devices/win_does_not_exist_xyz/command`)
        .set("Authorization", `Bearer ${token}`)
        .send({ command: "stop_recording", params: {} })
        .expect(404);

      expect(res.body.error).toMatch(/not found/i);
    });

    it("returns 400 when command body is missing", async () => {
      const { token } = await createAdmin();
      const device = await createWindowsDevice();

      const res = await request(app)
        .post(`/api/windows/devices/${device.deviceId}/command`)
        .set("Authorization", `Bearer ${token}`)
        .send({})
        .expect(400);

      expect(res.body.error).toMatch(/command is required/i);
    });

    it("requires admin auth (401 without token)", async () => {
      const device = await createWindowsDevice();
      await request(app)
        .post(`/api/windows/devices/${device.deviceId}/command`)
        .send({ command: "stop_recording" })
        .expect(401);
    });
  });

  // ── DeviceCommand enum completeness (v2.1.3) ─────────────────────────
  describe("WindowsDeviceCommand schema enum", () => {
    // The schema enum must cover every `case` arm in
    // lecturelens-windows-recorder/.../Heartbeat/CommandProcessor.cs.
    // v2.1.3 added 5 commands the device was already listening for but
    // the schema rejected (Mongoose ValidationError -> HTTP 500).
    const ALL_COMMANDS = [
      "start_recording",
      "stop_recording",
      "restart_recorder",         // ← added v2.1.3
      "restart_obs",
      "restart_service",
      "restart_pc",
      "pull_logs",
      "capture_screenshot",
      "update_config",
      "validate_license",
      "clear_recordings",
      "force_record",             // ← added v2.1.3
      "run_disk_cleanup",         // ← added v2.1.3
      "start_live_watch",
      "stop_live_watch",
      "disable_live_watch",       // ← added v2.1.3
      "enable_live_watch",        // ← added v2.1.3
    ];

    for (const cmd of ALL_COMMANDS) {
      it(`accepts "${cmd}" without ValidationError`, async () => {
        const { token } = await createAdmin();
        const device = await createWindowsDevice();
        await request(app)
          .post(`/api/windows/devices/${device.deviceId}/command`)
          .set("Authorization", `Bearer ${token}`)
          .send({ command: cmd, params: {} })
          .expect(201);
      });
    }

    it("REJECTS unknown commands (defensive — enum is a closed set)", async () => {
      const { token } = await createAdmin();
      const device = await createWindowsDevice();
      const res = await request(app)
        .post(`/api/windows/devices/${device.deviceId}/command`)
        .set("Authorization", `Bearer ${token}`)
        .send({ command: "definitely_not_a_real_command", params: {} });
      // Mongoose ValidationError surfaces as 500 in the current handler;
      // the important thing is it's NOT silently accepted.
      expect([400, 500]).toContain(res.status);
    });
  });

  // ── GET (single device) — same lookup pattern ────────────────────────
  describe("GET /api/windows/devices/:id", () => {
    it("finds by deviceId string", async () => {
      const { token } = await createAdmin();
      const device = await createWindowsDevice({ deviceId: "win_abc123def456" });
      const res = await request(app)
        .get(`/api/windows/devices/${device.deviceId}`)
        .set("Authorization", `Bearer ${token}`)
        .expect(200);
      expect(res.body.deviceId).toBe(device.deviceId);
    });

    it("finds by Mongo _id", async () => {
      const { token } = await createAdmin();
      const device = await createWindowsDevice();
      const res = await request(app)
        .get(`/api/windows/devices/${device._id}`)
        .set("Authorization", `Bearer ${token}`)
        .expect(200);
      expect(String(res.body._id)).toBe(String(device._id));
    });

    it("404 (not 500) for unknown deviceId", async () => {
      const { token } = await createAdmin();
      await request(app)
        .get(`/api/windows/devices/win_nonexistent`)
        .set("Authorization", `Bearer ${token}`)
        .expect(404);
    });
  });

  // ── DELETE / deregister ─────────────────────────────────────────────
  describe("DELETE /api/windows/devices/:id", () => {
    it("deregisters by deviceId (sets isActive=false)", async () => {
      const { token } = await createAdmin();
      const device = await createWindowsDevice();
      const res = await request(app)
        .delete(`/api/windows/devices/${device.deviceId}`)
        .set("Authorization", `Bearer ${token}`)
        .expect(200);
      expect(res.body.device.isActive).toBe(false);
    });

    it("404 for unknown deviceId (regression for CastError)", async () => {
      const { token } = await createAdmin();
      await request(app)
        .delete(`/api/windows/devices/win_garbage_id`)
        .set("Authorization", `Bearer ${token}`)
        .expect(404);
    });
  });

  // ── GET /commands list ──────────────────────────────────────────────
  describe("GET /api/windows/devices/:id/commands", () => {
    it("lists commands for a device by deviceId", async () => {
      const { token } = await createAdmin();
      const device = await createWindowsDevice();
      // Queue two commands first
      await request(app)
        .post(`/api/windows/devices/${device.deviceId}/command`)
        .set("Authorization", `Bearer ${token}`)
        .send({ command: "pull_logs" });
      await request(app)
        .post(`/api/windows/devices/${device.deviceId}/command`)
        .set("Authorization", `Bearer ${token}`)
        .send({ command: "capture_screenshot" });

      const res = await request(app)
        .get(`/api/windows/devices/${device.deviceId}/commands`)
        .set("Authorization", `Bearer ${token}`)
        .expect(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(2);
    });
  });
});
