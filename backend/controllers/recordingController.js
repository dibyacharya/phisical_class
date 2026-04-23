const mongoose = require("mongoose");
const Recording = require("../models/Recording");
const Room = require("../models/Room");

/**
 * Guard — return 400 if :id in req.params is not a valid ObjectId.
 * Without this, Mongoose's CastError bubbles to the global error handler
 * and returns a generic 500 with an unhelpful message.
 */
function requireValidId(req, res) {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    res.status(400).json({ error: "Invalid recording ID format" });
    return false;
  }
  return true;
}

// GET /api/recordings
exports.getAll = async (req, res) => {
  try {
    const { status } = req.query;
    const filter = {};
    if (status) filter.status = status;

    const recordings = await Recording.find(filter)
      .sort({ createdAt: -1 })
      .populate({
        path: "scheduledClass",
        select: "title courseName courseCode teacherName roomNumber date startTime endTime course teacher",
        populate: [
          { path: "course", select: "courseName courseCode" },
          { path: "teacher", select: "name" },
        ],
      });

    // Enrich with room hierarchy (campus > block > floor)
    const roomNumbers = [...new Set(recordings.map(r => r.scheduledClass?.roomNumber).filter(Boolean))];
    const rooms = await Room.find({ roomNumber: { $in: roomNumbers } }).lean();
    const roomMap = {};
    rooms.forEach(r => { roomMap[r.roomNumber] = { campus: r.campus, block: r.block, floor: r.floor || "", roomName: r.roomName || "" }; });

    const enriched = recordings.map(r => {
      const obj = r.toObject();
      const rn = obj.scheduledClass?.roomNumber;
      obj.room = roomMap[rn] || { campus: "", block: "", floor: "", roomName: "" };
      return obj;
    });

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /api/recordings/:id
exports.getOne = async (req, res) => {
  if (!requireValidId(req, res)) return;
  try {
    const rec = await Recording.findById(req.params.id).populate("scheduledClass");
    if (!rec) return res.status(404).json({ error: "Recording not found" });
    res.json(rec);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// PUT /api/recordings/:id/toggle-publish
exports.togglePublish = async (req, res) => {
  if (!requireValidId(req, res)) return;
  try {
    const rec = await Recording.findById(req.params.id);
    if (!rec) return res.status(404).json({ error: "Recording not found" });
    rec.isPublished = !rec.isPublished;
    await rec.save();
    res.json(rec);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// DELETE /api/recordings/:id
exports.remove = async (req, res) => {
  if (!requireValidId(req, res)) return;
  try {
    await Recording.findByIdAndDelete(req.params.id);
    res.json({ message: "Deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /api/recordings/:id/force-stop
// Admin fix for recordings stuck at "recording" or "uploading" — marks as
// completed if segments exist, otherwise failed. Useful when device crashed
// mid-recording and never called /merge to finalize.
exports.forceStop = async (req, res) => {
  if (!requireValidId(req, res)) return;
  try {
    const rec = await Recording.findById(req.params.id);
    if (!rec) return res.status(404).json({ error: "Recording not found" });

    const hasSegments = (rec.segments || []).length > 0;
    rec.status = hasSegments ? "completed" : "failed";
    rec.isPublished = hasSegments;
    rec.recordingEnd = rec.recordingEnd || new Date();

    // For recordings with segments but no final videoUrl, fall back to last segment
    if (hasSegments && !rec.videoUrl) {
      const last = rec.segments[rec.segments.length - 1];
      if (last?.videoUrl) rec.videoUrl = last.videoUrl;
    }

    // v2.6.3: keep mergeStatus coherent for the cases where merge will never
    // run. Single-segment / zero-segment recordings have nothing to concat,
    // so mark "skipped" explicitly instead of leaving the schema default
    // "pending" — UI uses this to decide whether to show "Merge segments"
    // button.
    if (!hasSegments) {
      rec.mergeStatus = "skipped";
    } else if (rec.segments.length === 1) {
      rec.mergeStatus = "skipped";
    }

    await rec.save();

    // If the device is still marked as recording this meeting, clear its state
    // AND queue a real force_stop command so the device actually stops capture.
    //
    // v3.1.5: the previous implementation only flipped DB state — the Android
    // service would keep recording, writing segments the admin portal had
    // already marked as "completed". Admins force-stopped from the portal
    // repeatedly with no effect because we never told the device.
    //
    // Now we also queue a DeviceCommand so the next heartbeat (within 30 s)
    // carries a force_stop payload the device will execute. Combined with the
    // Recording.status flip above this finalises *both* DB state and the
    // actual capture pipeline.
    let devicesNotified = 0;
    try {
      const ClassroomDevice = require("../models/ClassroomDevice");
      const DeviceCommand = require("../models/DeviceCommand");
      const meetingId = rec.scheduledClass?.toString();

      // Find every device currently claiming to record this meeting.
      // We look it up BEFORE updateMany so we still have deviceIds to dispatch
      // commands to (updateMany would null-out currentMeetingId on them).
      // Match on either currentMeetingId (top-level flag) OR isRecording=true
      // (since health desync can leave top=false while device still records).
      const query = meetingId
        ? { $or: [{ currentMeetingId: meetingId }, { isRecording: true, currentMeetingId: { $in: [null, ""] } }] }
        : { isRecording: true };
      const devices = await ClassroomDevice.find(query).select("deviceId").lean();

      if (meetingId) {
        await ClassroomDevice.updateMany(
          { currentMeetingId: meetingId, isRecording: true },
          { isRecording: false, currentMeetingId: null }
        );
      }

      for (const dev of devices) {
        if (!dev.deviceId) continue;
        await DeviceCommand.create({
          deviceId: dev.deviceId,
          command: "force_stop",
          issuedBy: (req.user?.name || req.user?.email || "admin") + " (via recording force-stop)",
          params: { recordingId: rec._id.toString() },
        });
        devicesNotified++;
      }
    } catch (err) {
      console.error(`[forceStop] device command queue failed: ${err.message}`);
    }

    // v3.1.3: flip ScheduledClass.status so the Room Booking page doesn't show
    // stale "Live" chips after a force-stop. Previously the status stayed at
    // "live" forever — confusing admins who saw 30-min-old classes still in
    // progress on the booking board.
    //
    // v3.1.8 correction: the previous version set status="cancelled" when the
    // force-stopped recording had zero segments. That turned out to be
    // user-hostile: the heartbeat schedule filter excludes cancelled classes
    // (`status: { $ne: "cancelled" }`), so an admin force-stopping a stuck
    // recording *before* any segment uploaded would kill the class itself —
    // next time the device heartbeated, the class was gone from its schedule
    // and no amount of retrying could recover it. User hit this exact trap
    // today: five back-to-back "why isn't my booking being recorded?" reports,
    // all traceable to a previous force-stop that silently cancelled the
    // class row.
    //
    // New rule: force-stop is a recording-level action, not a class-level
    // one. It should never transition a class to "cancelled" — an admin who
    // actually wants to cancel a class should use the dedicated Cancel button
    // on the booking UI. Here we only set "completed" when we have segments
    // (the recording produced something worth keeping); otherwise we leave
    // the class status alone so the device can still pick it up on the next
    // heartbeat and retry.
    try {
      const ScheduledClass = require("../models/ScheduledClass");
      const meetingId = rec.scheduledClass?.toString();
      if (meetingId && hasSegments) {
        await ScheduledClass.findByIdAndUpdate(meetingId, { status: "completed" });
      }
      // hasSegments === false → do NOT touch ScheduledClass.status. Let the
      // class remain "live" / "scheduled" so the device can retry.
    } catch (_) {}

    // v2.6.0: if the force-stopped recording has >1 segment, kick off a
    // merge in the background so the admin gets a single playable file.
    if (hasSegments && rec.segments.length > 1) {
      setImmediate(() => {
        const { runMergeForRecording } = require("../utils/segmentMerger");
        Recording.findById(rec._id)
          .then(fresh => fresh && runMergeForRecording(fresh))
          .catch(err => console.error(`[Merge/forceStop] ${err.message}`));
      });
    }

    res.json({
      message: hasSegments
        ? `Recording marked completed with ${rec.segments.length} segment(s)` +
          (devicesNotified ? ` — ${devicesNotified} device(s) force-stopped` : "")
        : "Recording marked failed (no segments uploaded — device likely crashed before capturing any frames)" +
          (devicesNotified ? ` — ${devicesNotified} device(s) force-stopped` : ""),
      recording: rec,
      devicesNotified,
      mergeStatus: hasSegments && rec.segments.length > 1 ? "queued" : "skipped",
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /api/recordings/:id/merge
//
// Admin-initiated merge (or re-merge) of a recording's segments. Useful when
// the initial post-finalise merge failed (e.g. ffmpeg wasn't yet deployed,
// a segment upload arrived late, a file was missing on disk).
//
// Idempotent: returns 200 with the cached mergedVideoUrl if mergeStatus is
// already "ready". Otherwise runs the merge synchronously (so the admin UI
// knows when it's done) and returns the result.
exports.retryMerge = async (req, res) => {
  if (!requireValidId(req, res)) return;
  try {
    const rec = await Recording.findById(req.params.id);
    if (!rec) return res.status(404).json({ error: "Recording not found" });
    if (!rec.segments || rec.segments.length === 0) {
      return res.status(400).json({ error: "Recording has no segments to merge" });
    }

    // Reset merging state if previously failed so the worker runs again
    if (rec.mergeStatus === "failed" || rec.mergeStatus === "merging") {
      rec.mergeStatus = "pending";
      rec.mergeError = "";
      await rec.save();
    }

    const { runMergeForRecording } = require("../utils/segmentMerger");
    const result = await runMergeForRecording(rec);

    // Reload so the response reflects the final persisted state
    const updated = await Recording.findById(req.params.id);
    res.json({
      ok: result.ok,
      mergeStatus: updated.mergeStatus,
      mergedVideoUrl: updated.mergedVideoUrl || "",
      mergedFileSize: updated.mergedFileSize || 0,
      mergedAt: updated.mergedAt,
      mergeError: updated.mergeError || "",
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /api/recordings/cleanup-stale
// Auto-fixes all recordings that have been "recording" or "uploading" for
// longer than STALE_MINUTES past their scheduled class end time.
exports.cleanupStale = async (req, res) => {
  try {
    const STALE_MINUTES = 15;
    const cutoff = new Date(Date.now() - STALE_MINUTES * 60 * 1000);

    const stuck = await Recording.find({
      status: { $in: ["recording", "uploading"] },
      // Either recording started long ago, OR never got an end time at all
      $or: [
        { recordingStart: { $lt: cutoff } },
        { createdAt: { $lt: cutoff } },
      ],
    });

    const fixed = [];
    for (const rec of stuck) {
      const hasSegments = (rec.segments || []).length > 0;
      rec.status = hasSegments ? "completed" : "failed";
      rec.isPublished = hasSegments;
      rec.recordingEnd = rec.recordingEnd || new Date();
      if (hasSegments && !rec.videoUrl) {
        const last = rec.segments[rec.segments.length - 1];
        if (last?.videoUrl) rec.videoUrl = last.videoUrl;
      }
      await rec.save();
      fixed.push({ id: rec._id, title: rec.title, status: rec.status, segments: rec.segments?.length || 0 });
    }

    // Also clear device flags for all classes the cleanup touched
    if (fixed.length > 0) {
      const ClassroomDevice = require("../models/ClassroomDevice");
      const meetingIds = stuck.map(r => r.scheduledClass?.toString()).filter(Boolean);
      if (meetingIds.length > 0) {
        await ClassroomDevice.updateMany(
          { currentMeetingId: { $in: meetingIds }, isRecording: true },
          { isRecording: false, currentMeetingId: null }
        );
      }
    }

    res.json({ fixed: fixed.length, details: fixed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
