/**
 * Recording Session Tests
 * Tests: findOrCreateSession, segment upload (multi-segment), merge, active-source
 */
const request = require("supertest");
const path = require("path");
const fs = require("fs");
const { setupTestDb } = require("./testDb");
const createApp = require("./app");
const { createDevice, createScheduledClass } = require("./helpers");
const Recording = require("../models/Recording");

setupTestDb();
const app = createApp();

describe("Recording API", () => {
  let device;

  beforeEach(async () => {
    device = await createDevice({ macAddress: "RE:CO:RD:TE:ST:01" });
  });

  // ── Session creation ────────────────────────────────────────
  describe("POST /api/classroom-recording/recordings/session", () => {
    it("should create a new recording session", async () => {
      const cls = await createScheduledClass();
      const res = await request(app)
        .post("/api/classroom-recording/recordings/session")
        .set("x-device-id", device.deviceId)
        .set("x-device-token", device.authToken)
        .send({ meetingId: cls._id.toString(), deviceId: device.deviceId, source: "android" })
        .expect(200);

      expect(res.body.recordingId).toBeDefined();
      expect(res.body.isNew).toBe(true);
      expect(res.body.hmacSecret).toBeDefined();
    });

    it("should return existing session for same meeting", async () => {
      const cls = await createScheduledClass();

      // First call creates
      const res1 = await request(app)
        .post("/api/classroom-recording/recordings/session")
        .set("x-device-id", device.deviceId)
        .set("x-device-token", device.authToken)
        .send({ meetingId: cls._id.toString(), deviceId: device.deviceId })
        .expect(200);

      // Second call returns existing
      const res2 = await request(app)
        .post("/api/classroom-recording/recordings/session")
        .set("x-device-id", device.deviceId)
        .set("x-device-token", device.authToken)
        .send({ meetingId: cls._id.toString(), deviceId: device.deviceId })
        .expect(200);

      expect(res2.body.recordingId).toBe(res1.body.recordingId);
      expect(res2.body.isNew).toBe(false);
    });

    it("should require meetingId", async () => {
      const res = await request(app)
        .post("/api/classroom-recording/recordings/session")
        .set("x-device-id", device.deviceId)
        .set("x-device-token", device.authToken)
        .send({})
        .expect(400);

      expect(res.body.error).toMatch(/meetingId/i);
    });

    it("should mark device as recording", async () => {
      const cls = await createScheduledClass();
      await request(app)
        .post("/api/classroom-recording/recordings/session")
        .set("x-device-id", device.deviceId)
        .set("x-device-token", device.authToken)
        .send({ meetingId: cls._id.toString(), deviceId: device.deviceId })
        .expect(200);

      const updated = await require("../models/ClassroomDevice").findOne({ deviceId: device.deviceId });
      expect(updated.isRecording).toBe(true);
    });
  });

  // ── Segment Upload ──────────────────────────────────────────
  describe("POST /api/classroom-recording/recordings/:id/segment-upload", () => {
    it("should upload a segment and append to segments array", async () => {
      const cls = await createScheduledClass();
      const sessRes = await request(app)
        .post("/api/classroom-recording/recordings/session")
        .set("x-device-id", device.deviceId)
        .set("x-device-token", device.authToken)
        .send({ meetingId: cls._id.toString(), deviceId: device.deviceId });

      const recordingId = sessRes.body.recordingId;

      // Create a tiny test file
      const testFilePath = path.join(__dirname, "..", "tmp", "test-segment.mp4");
      fs.writeFileSync(testFilePath, Buffer.alloc(2048, 0)); // 2KB dummy

      const res = await request(app)
        .post(`/api/classroom-recording/recordings/${recordingId}/segment-upload`)
        .set("x-device-id", device.deviceId)
        .set("x-device-token", device.authToken)
        .attach("video", testFilePath)
        .field("segmentIndex", "1")
        .field("duration", "300")
        .field("source", "android")
        .expect(200);

      expect(res.body.message).toMatch(/uploaded/i);

      // Verify segment was appended, not overwritten
      const recording = await Recording.findById(recordingId);
      expect(recording.segments.length).toBe(1);
      expect(recording.segments[0].segmentIndex).toBe(1);
      expect(recording.duration).toBe(300);

      // Clean up
      fs.unlinkSync(testFilePath);
    });

    it("should NOT overwrite videoUrl on subsequent segment uploads", async () => {
      const cls = await createScheduledClass();
      const sessRes = await request(app)
        .post("/api/classroom-recording/recordings/session")
        .set("x-device-id", device.deviceId)
        .set("x-device-token", device.authToken)
        .send({ meetingId: cls._id.toString(), deviceId: device.deviceId });

      const recordingId = sessRes.body.recordingId;

      // Upload segment 1
      const f1 = path.join(__dirname, "..", "tmp", "seg1.mp4");
      fs.writeFileSync(f1, Buffer.alloc(2048));
      await request(app)
        .post(`/api/classroom-recording/recordings/${recordingId}/segment-upload`)
        .set("x-device-id", device.deviceId)
        .set("x-device-token", device.authToken)
        .attach("video", f1)
        .field("segmentIndex", "1")
        .field("duration", "300")
        .expect(200);

      const afterSeg1 = await Recording.findById(recordingId);
      const url1 = afterSeg1.videoUrl;
      expect(url1).toBeTruthy();

      // Upload segment 2
      const f2 = path.join(__dirname, "..", "tmp", "seg2.mp4");
      fs.writeFileSync(f2, Buffer.alloc(2048));
      await request(app)
        .post(`/api/classroom-recording/recordings/${recordingId}/segment-upload`)
        .set("x-device-id", device.deviceId)
        .set("x-device-token", device.authToken)
        .attach("video", f2)
        .field("segmentIndex", "2")
        .field("duration", "300")
        .expect(200);

      // Verify both segments are preserved
      const afterSeg2 = await Recording.findById(recordingId);
      expect(afterSeg2.segments.length).toBe(2);
      expect(afterSeg2.videoUrl).toBe(url1); // First segment URL preserved
      expect(afterSeg2.duration).toBe(600);
      expect(afterSeg2.status).not.toBe("completed"); // NOT completed during segment upload

      // Clean up
      fs.unlinkSync(f1);
      fs.unlinkSync(f2);
    });
  });

  // ── Merge ───────────────────────────────────────────────────
  describe("POST /api/classroom-recording/recordings/:id/merge", () => {
    it("should finalize recording as completed", async () => {
      const cls = await createScheduledClass();
      const sessRes = await request(app)
        .post("/api/classroom-recording/recordings/session")
        .set("x-device-id", device.deviceId)
        .set("x-device-token", device.authToken)
        .send({ meetingId: cls._id.toString(), deviceId: device.deviceId });

      const recordingId = sessRes.body.recordingId;

      const res = await request(app)
        .post(`/api/classroom-recording/recordings/${recordingId}/merge`)
        .set("x-device-id", device.deviceId)
        .set("x-device-token", device.authToken)
        .expect(200);

      expect(res.body.message).toMatch(/merge/i);

      const recording = await Recording.findById(recordingId);
      expect(recording.status).toBe("completed");
      expect(recording.isPublished).toBe(true);
    });
  });

  // ── Active Source ───────────────────────────────────────────
  describe("POST /api/classroom-recording/recordings/:id/active-source", () => {
    it("should acknowledge active source update", async () => {
      const cls = await createScheduledClass();
      const sessRes = await request(app)
        .post("/api/classroom-recording/recordings/session")
        .set("x-device-id", device.deviceId)
        .set("x-device-token", device.authToken)
        .send({ meetingId: cls._id.toString(), deviceId: device.deviceId });

      const recordingId = sessRes.body.recordingId;

      const res = await request(app)
        .post(`/api/classroom-recording/recordings/${recordingId}/active-source`)
        .set("x-device-id", device.deviceId)
        .set("x-device-token", device.authToken)
        .send({ source: "android" })
        .expect(200);

      expect(res.body.source).toBe("android");
    });
  });
});
