/**
 * Segment merger — lossless concatenation of per-segment MP4 files into a
 * single playable recording. Uses ffmpeg's `concat` demuxer with `-c copy`
 * so audio/video streams are muxed as-is: zero re-encoding, zero quality
 * loss, ~1 GB/sec on commodity Railway hardware.
 *
 * Preconditions:
 *   - ffmpeg is on PATH (nixpacks.toml installs it during image build)
 *   - All segments have identical codec/profile/resolution/timebase
 *     (guaranteed because they come from the same encoder on the same
 *     device, rotated every 5 min with the stored format)
 *   - Segment files exist in /uploads
 *
 * Failure semantics:
 *   - If ffmpeg is missing (local dev without install), logs once and
 *     returns { ok: false, error: "ffmpeg_missing" }
 *   - If a segment file is missing on disk, merge aborts cleanly with
 *     error + lists which files were missing
 *   - If ffmpeg exits non-zero, stderr tail is surfaced
 *
 * This module is deliberately dependency-free (no fluent-ffmpeg) — the
 * concat demuxer call is two lines of `spawn` and we want zero layers
 * between Node and ffmpeg for reliability.
 */

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const UPLOADS_DIR = path.resolve(__dirname, "..", "uploads");

let ffmpegAvailable = null;  // memoised after first probe

/**
 * Probe ffmpeg availability once at startup. Caches result so we don't
 * fork a process on every merge.
 */
async function probeFfmpeg() {
  if (ffmpegAvailable !== null) return ffmpegAvailable;
  try {
    await new Promise((resolve, reject) => {
      const p = spawn("ffmpeg", ["-version"], { stdio: "ignore" });
      p.on("error", reject);
      p.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`exit ${code}`)));
    });
    ffmpegAvailable = true;
  } catch (err) {
    ffmpegAvailable = false;
    console.warn("[segmentMerger] ffmpeg not available on PATH —", err.message);
  }
  return ffmpegAvailable;
}

/**
 * Convert a segment.videoUrl (e.g. "/uploads/abc.mp4") to an absolute
 * filesystem path for ffmpeg input.
 */
function resolveSegmentPath(videoUrl) {
  if (!videoUrl) return null;
  // Only /uploads/… paths are merge-eligible. GridFS segments would need
  // a streaming-download pre-step — not in v2.6.0 scope.
  if (!videoUrl.startsWith("/uploads/")) return null;
  const rel = videoUrl.replace(/^\/uploads\//, "");
  const full = path.join(UPLOADS_DIR, rel);
  return full;
}

/**
 * Run ffmpeg concat. Returns { ok, outPath?, size?, durationMs?, stderrTail?, error? }.
 * Does NOT mutate the Recording document — that's the caller's job.
 */
async function mergeSegmentsToFile(segments, recordingId) {
  const available = await probeFfmpeg();
  if (!available) {
    return { ok: false, error: "ffmpeg_missing" };
  }
  if (!Array.isArray(segments) || segments.length === 0) {
    return { ok: false, error: "no_segments" };
  }

  // Sort by segmentIndex so ordering is deterministic regardless of upload
  // race conditions on the device. segmentIndex is 1-based.
  const ordered = [...segments].sort((a, b) => (a.segmentIndex || 0) - (b.segmentIndex || 0));

  // Validate every segment file exists before starting ffmpeg — saves time
  // on bigger merges that would otherwise crash halfway through.
  const missing = [];
  const paths = [];
  for (const s of ordered) {
    const p = resolveSegmentPath(s.videoUrl);
    if (!p || !fs.existsSync(p)) {
      missing.push(s.videoUrl || "<null>");
    } else {
      paths.push(p);
    }
  }
  if (missing.length > 0) {
    return { ok: false, error: "segments_missing", missing };
  }

  // Build the concat list file: ffmpeg reads a plaintext manifest of
  // `file '/abs/path.mp4'` lines. Using absolute paths avoids any confusion
  // with the working directory of the spawned process.
  const listPath = path.join(UPLOADS_DIR, `${recordingId}_mergelist.txt`);
  const outPath  = path.join(UPLOADS_DIR, `${recordingId}_merged.mp4`);
  // ffmpeg concat list format: single-quote paths, escape embedded
  // single-quotes (none expected in our filenames but defensive).
  const listBody = paths
    .map(p => `file '${p.replace(/'/g, "'\\''")}'`)
    .join("\n") + "\n";
  try {
    fs.writeFileSync(listPath, listBody, "utf8");
  } catch (err) {
    return { ok: false, error: "list_write_failed", detail: err.message };
  }

  // v3.1.3: back to pure remux. v3.1.2's re-encode attempt hit trouble
  // scaling the GL-compositor PTS bug (40x inflated timestamps) — any
  // server-side fix ended up either losing content or doubling duration.
  // Since Android v3.1.3 flips GL compositor OFF by default, legacy
  // direct-to-encoder path writes correct PTS, and `-c copy` just
  // rewrites the container metadata cleanly.
  const args = [
    "-y",
    "-v", "error",
    "-f", "concat",
    "-safe", "0",
    "-fflags", "+genpts",
    "-i", listPath,
    "-c", "copy",
    "-movflags", "+faststart",
    outPath,
  ];

  const startMs = Date.now();
  let stderrBuf = "";
  const { ok, exitCode } = await new Promise((resolve) => {
    const p = spawn("ffmpeg", args);
    p.stderr.on("data", (chunk) => {
      stderrBuf += chunk.toString();
      // Cap buffer at 16 KB; only the tail matters for error reporting
      if (stderrBuf.length > 16384) stderrBuf = stderrBuf.slice(-16384);
    });
    p.on("error", (err) => resolve({ ok: false, exitCode: -1, err: err.message }));
    p.on("exit", (code) => resolve({ ok: code === 0, exitCode: code }));
  });

  // Clean up list file regardless of success
  try { fs.unlinkSync(listPath); } catch (_) {}

  if (!ok) {
    try { fs.unlinkSync(outPath); } catch (_) {}
    return {
      ok: false,
      error: "ffmpeg_failed",
      exitCode,
      stderrTail: stderrBuf.slice(-2000),
    };
  }

  let size = 0;
  try { size = fs.statSync(outPath).size; } catch (_) {}
  if (size === 0) {
    return { ok: false, error: "merge_output_empty" };
  }

  return {
    ok: true,
    outPath,
    videoUrl: `/uploads/${path.basename(outPath)}`,
    size,
    durationMs: Date.now() - startMs,
  };
}

/**
 * End-to-end merge: call this after a recording transitions to "completed".
 * Updates the Recording document with mergedVideoUrl + mergeStatus. Safe
 * to call multiple times (idempotent via atomic mergeStatus gating).
 *
 * v2.6.3 hardening:
 * - Reload from DB before checking mergeStatus (previous caller-provided
 *   doc may be stale).
 * - Use findOneAndUpdate with status gate to claim "merging" atomically —
 *   two concurrent callers can't both start ffmpeg.
 * - Every save() wrapped in try-catch so a DB failure never leaves the
 *   recording stuck at mergeStatus="merging" forever.
 */
async function runMergeForRecording(recording) {
  if (!recording) return { ok: false, error: "no_recording" };

  // Reload — the doc the caller handed us may be stale relative to a
  // concurrent heartbeat-reconcile or admin retry.
  const Recording = require("../models/Recording");
  const fresh = await Recording.findById(recording._id);
  if (!fresh) return { ok: false, error: "recording_deleted" };

  // v3.1.2: Single-segment path now ALSO runs through ffmpeg (-c copy + genpts).
  //
  // Why: Android MediaMuxer on the 55TR3DK pilot TV (GL compositor mode)
  // writes a bogus mvhd duration — stream packets span 293s but the MP4
  // header declares 12458s, so browsers show a 3.5-hour timeline for a
  // 5-minute clip. Remuxing with `-c copy -fflags +genpts` keeps the
  // video/audio data byte-for-byte but rebuilds container metadata from
  // actual packet timestamps, which fixes the duration.
  //
  // For zero segments there's nothing to do.
  if (!fresh.segments || fresh.segments.length === 0) {
    try {
      await Recording.findByIdAndUpdate(fresh._id, { $set: { mergeStatus: "skipped" } });
    } catch (err) {
      console.error(`[segmentMerger] save-skipped failed ${fresh._id}: ${err.message}`);
    }
    return { ok: true, skipped: true };
  }

  // Fast-path: already merged.
  if (fresh.mergeStatus === "ready" && fresh.mergedVideoUrl) {
    return { ok: true, alreadyMerged: true };
  }

  // Atomic claim: only one caller can flip from non-merging → merging.
  // This prevents two concurrent runs from both spawning ffmpeg against
  // the same output file.
  const claim = await Recording.findOneAndUpdate(
    { _id: fresh._id, mergeStatus: { $ne: "merging" } },
    { $set: { mergeStatus: "merging", mergeError: "" } },
    { new: true }
  );
  if (!claim) {
    // Someone else is already merging this recording.
    return { ok: false, error: "already_merging" };
  }

  const result = await mergeSegmentsToFile(claim.segments, claim._id.toString());

  if (!result.ok) {
    try {
      await Recording.findByIdAndUpdate(claim._id, {
        $set: {
          mergeStatus: "failed",
          mergeError: JSON.stringify({
            error: result.error,
            detail: result.stderrTail || result.detail || result.missing || "",
          }).slice(0, 2000),
        },
      });
    } catch (err) {
      console.error(`[segmentMerger] save-failed persist failed ${claim._id}: ${err.message}`);
    }
    console.error(`[segmentMerger] Merge failed for ${claim._id}: ${result.error}`);
    return result;
  }

  try {
    await Recording.findByIdAndUpdate(claim._id, {
      $set: {
        mergedVideoUrl: result.videoUrl,
        mergedFileSize: result.size,
        mergeStatus: "ready",
        mergedAt: new Date(),
        // Promote merged URL to canonical videoUrl — players/download
        // endpoints use this going forward. Segments remain for audit.
        videoUrl: result.videoUrl,
      },
    });
  } catch (err) {
    // Merge succeeded on disk but DB save failed. Log loudly — admin can
    // retry via POST /recordings/:id/merge to re-record the URL (idempotent
    // because the merged file already exists and mergeSegmentsToFile will
    // overwrite with identical content).
    console.error(`[segmentMerger] FINAL SAVE FAILED ${claim._id} — file is at ${result.outPath}: ${err.message}`);
    return { ok: false, error: "final_save_failed", detail: err.message, outPath: result.outPath };
  }

  console.log(`[segmentMerger] Merged ${claim.segments.length} segments → ` +
    `${(result.size / 1024 / 1024).toFixed(1)} MB in ${result.durationMs}ms (${claim._id})`);
  return result;
}

module.exports = { mergeSegmentsToFile, runMergeForRecording, probeFfmpeg };
