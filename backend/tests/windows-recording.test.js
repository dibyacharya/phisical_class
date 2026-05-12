/**
 * Windows recording endpoints — covers v2.2.x R2 migration + the
 * delete endpoint added in commit 7d42a80.
 *
 * Key invariants tested:
 *   1. finalize: when device sends {r2ObjectKey, r2PublicUrl, r2Bucket},
 *      the row gets all R2 fields persisted AND mergedVideoUrl is
 *      mirrored from r2PublicUrl so legacy admin-portal readers
 *      (which still look at mergedVideoUrl) keep working.
 *   2. finalize: legacy path (mergedVideoUrl only, no r2 fields) still
 *      works for in-flight devices on v2.1.x.
 *   3. finalize: capture-only payload (neither r2 nor mergedVideoUrl)
 *      sets mergeStatus="pending" — the failure-isolation path.
 *   4. DELETE /api/windows/recordings/:id hard-deletes and 404s on miss.
 */

const request = require("supertest");
const { setupTestDb } = require("./testDb");
const createApp = require("./app");
const {
  createAdmin,
  createWindowsDevice,
  createScheduledClass,
  createWindowsRecording,
} = require("./helpers");
const WindowsRecording = require("../models/windows/WindowsRecording");

setupTestDb();
const app = createApp();

describe("Windows recording finalize", () => {
  describe("POST /api/windows/recordings/:id/finalize — R2 path (v2.2.x)", () => {
    it("persists r2ObjectKey + r2PublicUrl + r2Bucket and mirrors into mergedVideoUrl", async () => {
      const cls = await createScheduledClass();
      const device = await createWindowsDevice();
      const rec = await createWindowsRecording(cls, device);

      const r2PublicUrl =
        "https://pub-2d99492768894067b600bca769528e2c.r2.dev/" +
        "physical-class-recordings/2026-05-12/001/win_abcd/final.mp4";
      const r2ObjectKey =
        "physical-class-recordings/2026-05-12/001/win_abcd/final.mp4";

      const res = await request(app)
        .post(`/api/windows/recordings/${rec._id}/finalize`)
        .set("X-Device-Id", device.deviceId)
        .set("X-Device-Token", device.authToken)
        .send({
          recordingEnd: new Date().toISOString(),
          duration: 180,
          mergedVideoUrl: r2PublicUrl,
          mergedFileSize: 109_200_058,
          r2ObjectKey,
          r2PublicUrl,
          r2Bucket: "lecturelens-recordings",
        })
        .expect(200);

      // Backend response carries the saved row
      expect(res.body.recording.status).toBe("completed");
      expect(res.body.recording.mergeStatus).toBe("ready");

      // Pull fresh from DB to verify persistence
      const persisted = await WindowsRecording.findById(rec._id);
      expect(persisted.r2ObjectKey).toBe(r2ObjectKey);
      expect(persisted.r2PublicUrl).toBe(r2PublicUrl);
      expect(persisted.r2Bucket).toBe("lecturelens-recordings");
      // Mirror — admin portal reads this field
      expect(persisted.mergedVideoUrl).toBe(r2PublicUrl);
      expect(persisted.mergedFileSize).toBe(109_200_058);
      expect(persisted.fileSize).toBe(109_200_058);
      expect(persisted.status).toBe("completed");
      expect(persisted.mergeStatus).toBe("ready");
      expect(persisted.isPublished).toBe(true);
      expect(persisted.mergedAt).toBeTruthy();
    });

    it("R2 fields require BOTH r2ObjectKey + r2PublicUrl (mergedVideoUrl alone falls back to legacy path)", async () => {
      const cls = await createScheduledClass();
      const device = await createWindowsDevice();
      const rec = await createWindowsRecording(cls, device);

      // Send r2ObjectKey but no r2PublicUrl — controller should fall through
      // to legacy mergedVideoUrl handling (mergedVideoUrl IS present here so
      // the recording still completes — just without the r2 metadata stored).
      await request(app)
        .post(`/api/windows/recordings/${rec._id}/finalize`)
        .set("X-Device-Id", device.deviceId)
        .set("X-Device-Token", device.authToken)
        .send({
          recordingEnd: new Date().toISOString(),
          duration: 180,
          mergedVideoUrl: "https://example.com/legacy.mp4",
          mergedFileSize: 10000,
          r2ObjectKey: "stray-key-without-url",
          // r2PublicUrl missing!
        })
        .expect(200);

      const persisted = await WindowsRecording.findById(rec._id);
      expect(persisted.r2ObjectKey).toBeFalsy();
      expect(persisted.mergedVideoUrl).toBe("https://example.com/legacy.mp4");
      expect(persisted.status).toBe("completed");
    });
  });

  describe("POST /api/windows/recordings/:id/finalize — legacy Azure path", () => {
    it("accepts mergedVideoUrl only (pre-v2.2.0 devices)", async () => {
      const cls = await createScheduledClass();
      const device = await createWindowsDevice();
      const rec = await createWindowsRecording(cls, device);

      const azureUrl =
        "https://stgkiitlmsdev.blob.core.windows.net/lms-storage/" +
        "physical-class-recordings/2026-05-06/001/win_legacy/final.mp4";

      await request(app)
        .post(`/api/windows/recordings/${rec._id}/finalize`)
        .set("X-Device-Id", device.deviceId)
        .set("X-Device-Token", device.authToken)
        .send({
          recordingEnd: new Date().toISOString(),
          duration: 180,
          mergedVideoUrl: azureUrl,
          mergedFileSize: 50_000_000,
        })
        .expect(200);

      const persisted = await WindowsRecording.findById(rec._id);
      expect(persisted.mergedVideoUrl).toBe(azureUrl);
      expect(persisted.r2ObjectKey).toBeFalsy();
      expect(persisted.r2PublicUrl).toBeFalsy();
      expect(persisted.status).toBe("completed");
      expect(persisted.mergeStatus).toBe("ready");
    });
  });

  describe("POST /api/windows/recordings/:id/finalize — capture-only (no upload)", () => {
    it("leaves recording in merging/pending when neither r2 nor mergedVideoUrl present", async () => {
      const cls = await createScheduledClass();
      const device = await createWindowsDevice();
      const rec = await createWindowsRecording(cls, device);

      await request(app)
        .post(`/api/windows/recordings/${rec._id}/finalize`)
        .set("X-Device-Id", device.deviceId)
        .set("X-Device-Token", device.authToken)
        .send({
          recordingEnd: new Date().toISOString(),
          duration: 180,
        })
        .expect(200);

      const persisted = await WindowsRecording.findById(rec._id);
      expect(persisted.status).toBe("merging");
      expect(persisted.mergeStatus).toBe("pending");
      expect(persisted.r2ObjectKey).toBeFalsy();
      expect(persisted.mergedVideoUrl).toBeFalsy();
    });
  });
});

describe("DELETE /api/windows/recordings/:id (v2.2.x admin cleanup)", () => {
  it("hard-deletes the recording row", async () => {
    const { token } = await createAdmin();
    const cls = await createScheduledClass();
    const device = await createWindowsDevice();
    const rec = await createWindowsRecording(cls, device);

    await request(app)
      .delete(`/api/windows/recordings/${rec._id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    const after = await WindowsRecording.findById(rec._id);
    expect(after).toBeNull();
  });

  it("404 when recording does not exist", async () => {
    const { token } = await createAdmin();
    // Valid-looking ObjectId that doesn't match anything
    await request(app)
      .delete(`/api/windows/recordings/000000000000000000000000`)
      .set("Authorization", `Bearer ${token}`)
      .expect(404);
  });

  it("requires admin auth", async () => {
    const cls = await createScheduledClass();
    const device = await createWindowsDevice();
    const rec = await createWindowsRecording(cls, device);
    await request(app)
      .delete(`/api/windows/recordings/${rec._id}`)
      .expect(401);
  });
});
