const WindowsRecording = require("../../models/windows/WindowsRecording");
const WindowsDevice = require("../../models/windows/WindowsDevice");
const ScheduledClass = require("../../models/ScheduledClass");
const Recording = require("../../models/Recording"); // Android recordings (shared R2 bucket)
const { Readable } = require("stream");
const { listAllObjects, deleteObjects } = require("../../utils/r2");

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
 * GET /api/windows/recordings/:id/download
 *
 * Proxies the recording's merged video (stored on Cloudflare R2 at a
 * public bucket URL) through this backend with a `Content-Disposition:
 * attachment` header so the browser saves the file instead of opening it
 * inline.
 *
 * Why this exists: the admin portal Download button on the Windows →
 * Recordings page can't force-download a cross-origin R2 URL via the HTML
 * `<a download>` attribute — modern browsers ignore that attribute on any
 * URL whose origin differs from the page (security mitigation against
 * abuse). Proxying through our own origin both restores the download
 * behavior AND lets us set a friendly filename derived from class title
 * + room + date instead of the opaque R2 object key.
 *
 * Trade-off: Railway egress cost (file streams from R2 → backend → admin
 * browser). For occasional admin downloads this is acceptable. If high
 * traffic patterns emerge, migrate to R2 signed URLs with the
 * `response-content-disposition` query override.
 *
 * Auth: same admin auth as the rest of /api/windows/recordings/*. Caller
 * must pass `Authorization: Bearer <admin token>`. Frontend wraps this
 * with an authenticated fetch + blob trigger.
 */
exports.download = async (req, res) => {
  try {
    const rec = await WindowsRecording.findById(req.params.id)
      .populate("scheduledClass", "title subject")
      .populate("windowsDevice", "roomNumber");
    if (!rec) return res.status(404).json({ error: "Recording not found" });

    const sourceUrl = rec.mergedVideoUrl;
    if (!sourceUrl) {
      return res.status(404).json({
        error: "Recording not yet finalized — no merged video available",
      });
    }

    // Build a friendly filename: "<Title>_Room<NNN>_YYYY-MM-DD.mp4"
    // Sanitize aggressively — Windows + Linux both have issues with various
    // characters, and Content-Disposition itself escapes quotes/control chars.
    const dt = (rec.recordingStart || rec.createdAt || new Date())
      .toISOString()
      .slice(0, 10);
    const baseTitle =
      rec.scheduledClass?.title || rec.title || "recording";
    const room =
      rec.roomNumber || rec.windowsDevice?.roomNumber || "x";
    const safe = (s) =>
      String(s)
        .replace(/[^a-zA-Z0-9-]+/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_|_$/g, "")
        .slice(0, 60); // cap segment length so filename stays sane
    const filename = `${safe(baseTitle)}_Room${safe(room)}_${dt}.mp4`;

    // Stream from R2. Node 18+ `fetch` returns a Web ReadableStream which
    // we convert with `Readable.fromWeb` so we can `.pipe()` it onto the
    // Express response. This streams byte-for-byte without buffering the
    // whole file in memory.
    const r2Resp = await fetch(sourceUrl);
    if (!r2Resp.ok) {
      console.error(
        "[recordings.download] R2 upstream failure:",
        r2Resp.status,
        sourceUrl
      );
      return res
        .status(502)
        .json({ error: `Upstream storage returned ${r2Resp.status}` });
    }

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}"`
    );
    res.setHeader("Content-Type", "video/mp4");
    const upstreamLen = r2Resp.headers.get("content-length");
    if (upstreamLen) res.setHeader("Content-Length", upstreamLen);

    Readable.fromWeb(r2Resp.body)
      .on("error", (streamErr) => {
        console.error(
          "[recordings.download] Stream error:",
          streamErr.message
        );
        if (!res.headersSent) {
          res.status(500).json({ error: "Stream error during download" });
        } else {
          // Headers already sent — best we can do is destroy the connection
          // so the client knows the file is incomplete.
          res.destroy(streamErr);
        }
      })
      .pipe(res);
  } catch (err) {
    console.error("[recordings.download] Error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
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
 * POST /api/windows/recordings/:id/status   (device)
 *
 * 2026-05-16 — Intermediate lifecycle status from the recorder.
 *
 * After a recording stops, the device runs post-processing (chunk concat +
 * PIP composite) and then uploads the final.mp4 — together ~2-3 minutes —
 * before calling /finalize. Until /finalize the recording doc still said
 * status="recording", so the admin portal couldn't distinguish "class is
 * being recorded live" from "class ended, still processing/uploading".
 *
 * The recorder now POSTs "merging" (post-process start) then "uploading"
 * (upload start) here, so the Recordings page reflects the true phase.
 */
exports.reportStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const allowed = ["recording", "merging", "uploading", "completed", "failed"];
    if (!allowed.includes(status)) {
      return res.status(400).json({ error: `Invalid status: ${status}` });
    }

    const rec = await WindowsRecording.findById(req.params.id);
    if (!rec) return res.status(404).json({ error: "Recording not found" });

    // Never regress a terminal state — once /finalize set "completed" (or a
    // failure was recorded), a late status report must not undo it.
    if (rec.status === "completed" || rec.status === "failed") {
      return res.json({
        message: "Recording already in a terminal state — status unchanged",
        recording: rec,
      });
    }

    rec.status = status;
    await rec.save();
    res.json({ message: "Status updated", recording: rec });
  } catch (err) {
    console.error("[WinRec/reportStatus] Error:", err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * DELETE /api/windows/recordings/:id   (admin)
 *
 * Hard-deletes a recording row. Used to prune stuck `merging` / `recording`
 * entries left over from pre-v2.2.0 failed uploads — the recording Mongo
 * doc lingers because the device never sent a finalize call. The blob in
 * Cloudflare R2 (if any was uploaded) is NOT touched by this — admin can
 * tidy R2 separately if they want; for the merging-stuck rows there's
 * usually nothing in R2 anyway.
 *
 * Why not soft-delete: the admin portal lists everything not-soft-deleted
 * already, so a soft-delete column would just need another query. For
 * the cleanup use-case a hard delete is fine; if we later want a
 * "recently deleted" view we'll add it.
 */
exports.remove = async (req, res) => {
  try {
    const rec = await WindowsRecording.findByIdAndDelete(req.params.id);
    if (!rec) return res.status(404).json({ error: "Recording not found" });
    res.json({ message: "Deleted", _id: rec._id });
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

// ── R2 storage audit / orphan cleanup (2026-05-17) ─────────────────────────
//
// Recordings deleted from the admin portal intentionally leave their R2 file
// behind (cold-storage safety net). Over time R2 accumulates objects that no
// recording document references. These helpers find + prune them.
//
// CRITICAL: the R2 bucket's `physical-class-recordings/` prefix is shared by
// BOTH the Windows Mini-PC fleet (WindowsRecording collection) AND the Android
// Smart-TV fleet (Recording collection, written by LiveKit Egress). The
// "kept" set MUST union BOTH collections — otherwise this would delete every
// Android recording. It also skips objects modified in the last 48h so an
// in-flight recording whose document isn't finalized yet is never touched.

const R2_RECENT_SKIP_MS = 48 * 60 * 60 * 1000;

// Extract the bucket-relative object key from a stored URL or a bare key.
function _r2KeyFromValue(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) return s.replace(/^\/+/, ""); // already a key
  const m = s.match(/^https?:\/\/[^/]+\/(.+)$/);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

// Build the set of R2 keys referenced by ANY recording in EITHER collection,
// then diff against the live R2 listing. Returns the full picture; deletes
// nothing.
async function _computeR2Orphans() {
  const prefixRaw = process.env.R2_PATH_PREFIX || "physical-class-recordings";
  const prefix = prefixRaw.replace(/^\/+|\/+$/g, "") + "/";

  const kept = new Set();
  const add = (v) => {
    const k = _r2KeyFromValue(v);
    if (k) kept.add(k);
  };

  // Windows recordings
  const winRecs = await WindowsRecording.find(
    {},
    "r2ObjectKey r2PublicUrl mergedVideoUrl chunks"
  ).lean();
  for (const r of winRecs) {
    add(r.r2ObjectKey);
    add(r.r2PublicUrl);
    add(r.mergedVideoUrl);
    for (const c of r.chunks || []) add(c.azureBlobUrl);
  }

  // Android recordings — SAME bucket/prefix, written by LiveKit Egress.
  const andRecs = await Recording.find(
    {},
    "mergedVideoUrl videoUrl audioUrl thumbnailUrl segments"
  ).lean();
  for (const r of andRecs) {
    add(r.mergedVideoUrl);
    add(r.videoUrl);
    add(r.audioUrl);
    add(r.thumbnailUrl);
    for (const s of r.segments || []) add(s.videoUrl);
  }

  // SAFETY: if both collections returned 0 rows, abort — a DB hiccup must
  // never be interpreted as "every R2 object is an orphan".
  if (winRecs.length === 0 && andRecs.length === 0) {
    throw new Error("Aborting: both recording collections returned 0 rows");
  }

  const objects = await listAllObjects(prefix);
  const now = Date.now();
  const orphans = [];
  let skippedRecent = 0;
  let orphanBytes = 0;
  for (const o of objects) {
    if (kept.has(o.key)) continue;
    if (o.lastModified && now - new Date(o.lastModified).getTime() < R2_RECENT_SKIP_MS) {
      skippedRecent++;
      continue;
    }
    orphans.push(o);
    orphanBytes += o.size || 0;
  }
  orphans.sort((a, b) => (b.size || 0) - (a.size || 0));

  return {
    prefix,
    totalObjects: objects.length,
    keptKeys: kept.size,
    winRecordings: winRecs.length,
    androidRecordings: andRecs.length,
    skippedRecent,
    orphanCount: orphans.length,
    orphanBytes,
    orphans,
  };
}

/**
 * GET /api/windows/recordings/r2-audit   (admin)
 * DRY RUN — reports orphan R2 objects. Deletes nothing.
 */
exports.r2Audit = async (req, res) => {
  try {
    const r = await _computeR2Orphans();
    res.json(r);
  } catch (err) {
    console.error("[WinRec/r2Audit] Error:", err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * POST /api/windows/recordings/r2-cleanup   (admin)
 * Body: { confirm: "DELETE" }
 *
 * Recomputes orphans server-side and deletes them. The confirm string is the
 * human safety gate; orphans are always re-derived fresh here (never trusted
 * from the client) so nothing a recording references can ever be deleted.
 */
exports.r2Cleanup = async (req, res) => {
  try {
    if (!req.body || req.body.confirm !== "DELETE") {
      return res
        .status(400)
        .json({ error: 'Confirmation required: POST { "confirm": "DELETE" }' });
    }
    const r = await _computeR2Orphans();
    if (r.orphanCount === 0) {
      return res.json({ message: "No orphan objects — nothing to delete", deleted: 0 });
    }
    const { deleted, errors } = await deleteObjects(r.orphans.map((o) => o.key));
    console.log(
      `[WinRec/r2Cleanup] deleted ${deleted} orphan objects, ${errors.length} errors`
    );
    res.json({
      message: `Deleted ${deleted} orphan object(s)`,
      deleted,
      freedBytes: r.orphanBytes,
      errors,
    });
  } catch (err) {
    console.error("[WinRec/r2Cleanup] Error:", err);
    res.status(500).json({ error: err.message });
  }
};
