const WindowsRecording = require("../../models/windows/WindowsRecording");
const WindowsDevice = require("../../models/windows/WindowsDevice");
const ScheduledClass = require("../../models/ScheduledClass");

/**
 * GET /api/windows/recordings
 * Returns all Windows recordings for admin portal.
 */
exports.list = async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || "50"), 200);
    const roomNumber = req.query.roomNumber;
    const status = req.query.status;
    const classId = req.query.classId;

    const filter = {};
    if (roomNumber) filter.roomNumber = roomNumber;
    if (status) filter.status = status;
    if (classId) filter.scheduledClass = classId;

    const recordings = await WindowsRecording.find(filter)
      .populate("scheduledClass", "title roomNumber date startTime endTime courseName teacherName")
      .populate("windowsDevice", "deviceId name roomNumber")
      .sort({ createdAt: -1 })
      .limit(limit);

    res.json(recordings);
  } catch (err) {
    console.error("[WinRec/list] Error:", err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * GET /api/windows/recordings/:id
 */
exports.get = async (req, res) => {
  try {
    const rec = await WindowsRecording.findById(req.params.id)
      .populate("scheduledClass")
      .populate("windowsDevice", "deviceId name roomNumber");
    if (!rec) return res.status(404).json({ error: "Recording not found" });
    res.json(rec);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * POST /api/windows/recordings
 * Device endpoint — called by Windows app when class starts to create the recording document.
 * Auth: windowsDeviceAuth
 */
exports.create = async (req, res) => {
  try {
    const { classId, title, recordingStart } = req.body;
    if (!classId) return res.status(400).json({ error: "classId is required" });

    const cls = await ScheduledClass.findById(classId);
    if (!cls) return res.status(404).json({ error: "Class not found" });

    const rec = await WindowsRecording.create({
      scheduledClass: classId,
      windowsDevice: req.device._id,
      title: title || cls.title,
      roomNumber: cls.roomNumber,
      recordingStart: recordingStart ? new Date(recordingStart) : new Date(),
      status: "recording",
    });

    // Mark class as live
    await ScheduledClass.findByIdAndUpdate(classId, { status: "live" }).catch(() => {});

    res.status(201).json(rec);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * POST /api/windows/recordings/:id/chunk
 * Device endpoint — record a chunk's blob URL after upload completes.
 * Auth: windowsDeviceAuth
 * Body: { seq, filename, sizeBytes, durationMs, azureBlobUrl }
 */
exports.recordChunk = async (req, res) => {
  try {
    const rec = await WindowsRecording.findById(req.params.id);
    if (!rec) return res.status(404).json({ error: "Recording not found" });

    const { seq, filename, sizeBytes, durationMs, azureBlobUrl } = req.body;
    rec.chunks.push({
      seq,
      filename,
      sizeBytes,
      durationMs,
      azureBlobUrl,
      uploadStatus: "uploaded",
      uploadedAt: new Date(),
    });
    rec.status = "uploading";
    await rec.save();

    res.json({ message: "Chunk recorded", chunkCount: rec.chunks.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * POST /api/windows/recordings/:id/finalize
 * Device endpoint — called when recording stops. Device may already have done
 * the post-process merge locally and uploaded final.mp4; if so, it sends
 * mergedVideoUrl + mergedFileSize and the backend marks the recording fully
 * completed in one call. Otherwise (no merged URL), recording goes into a
 * "merging" state for a server-side worker.
 *
 * Auth: windowsDeviceAuth
 * Body: { recordingEnd, duration, mergedVideoUrl?, mergedFileSize? }
 */
exports.finalize = async (req, res) => {
  try {
    const rec = await WindowsRecording.findById(req.params.id);
    if (!rec) return res.status(404).json({ error: "Recording not found" });

    rec.recordingEnd = req.body.recordingEnd ? new Date(req.body.recordingEnd) : new Date();
    rec.duration = req.body.duration || Math.floor((rec.recordingEnd - rec.recordingStart) / 1000);

    // v2.2.0 — Cloudflare R2 upload path. Device uploads final.mp4 to R2 and
    // sends back the bucket + object key + already-rendered public URL. We
    // mirror the URL into the legacy mergedVideoUrl field so existing admin
    // portal UI code that reads mergedVideoUrl still works without changes.
    //
    // v2.0.4 (legacy Azure path) still accepted: if the device sends only
    // mergedVideoUrl (no r2*), we fall through to the original behaviour so
    // pre-v2.2.0 fleet in the field continues to work during rollout.
    if (req.body.r2ObjectKey && req.body.r2PublicUrl) {
      rec.r2ObjectKey = req.body.r2ObjectKey;
      rec.r2PublicUrl = req.body.r2PublicUrl;
      rec.r2Bucket   = req.body.r2Bucket || "";
      rec.mergedVideoUrl = req.body.r2PublicUrl;     // mirror for back-compat readers
      if (req.body.mergedFileSize) {
        rec.mergedFileSize = req.body.mergedFileSize;
        rec.fileSize = req.body.mergedFileSize;
      }
      rec.mergeStatus = "ready";
      rec.mergedAt = new Date();
      rec.status = "completed";
      rec.isPublished = true;
    } else if (req.body.mergedVideoUrl) {
      // legacy Azure path
      rec.mergedVideoUrl = req.body.mergedVideoUrl;
      if (req.body.mergedFileSize) {
        rec.mergedFileSize = req.body.mergedFileSize;
        rec.fileSize = req.body.mergedFileSize;
      }
      rec.mergeStatus = "ready";
      rec.mergedAt = new Date();
      rec.status = "completed";
      rec.isPublished = true;
    } else {
      // capture-only — server will merge (rarely used in practice)
      rec.status = "merging";
      rec.mergeStatus = "pending";
    }

    await rec.save();

    if (rec.scheduledClass) {
      await ScheduledClass.findByIdAndUpdate(rec.scheduledClass, { status: "completed" }).catch(() => {});
    }

    res.json({
      message: rec.mergedVideoUrl ? "Recording finalized + published" : "Recording finalized — merge pending",
      recording: rec,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * POST /api/windows/recordings/:id/admin-set-merged
 * Admin endpoint to manually set mergedVideoUrl (for use until ffmpeg merge worker exists)
 */
exports.setMerged = async (req, res) => {
  try {
    const { mergedVideoUrl, mergedFileSize } = req.body;
    const rec = await WindowsRecording.findByIdAndUpdate(
      req.params.id,
      {
        mergedVideoUrl,
        mergedFileSize,
        fileSize: mergedFileSize,
        mergeStatus: "ready",
        mergedAt: new Date(),
        status: "completed",
        isPublished: true,
      },
      { new: true }
    );
    res.json(rec);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
