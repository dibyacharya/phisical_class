const mongoose = require("mongoose");

const recordingSchema = new mongoose.Schema(
  {
    scheduledClass: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LCS_ScheduledClass",
      required: true,
    },
    title: { type: String, required: true },
    videoUrl: { type: String, default: "" },         // Final merged video URL (set after merge)
    thumbnailUrl: { type: String, default: "" },
    duration: { type: Number, default: 0 },          // total seconds
    fileSize: { type: Number, default: 0 },          // total bytes
    // Multi-segment support: each 5-min segment is stored here, videoUrl is set on merge
    segments: [{
      segmentIndex: { type: Number },
      videoUrl: { type: String },
      fileSize: { type: Number, default: 0 },
      duration: { type: Number, default: 0 },
      startTime: { type: Date },
      endTime: { type: Date },
      uploadedAt: { type: Date, default: Date.now },
    }],
    status: {
      type: String,
      enum: ["recording", "uploading", "completed", "failed"],
      default: "recording",
    },
    recordingStart: { type: Date },
    recordingEnd: { type: Date },
    isPublished: { type: Boolean, default: false },
    // ── v2.6.0+: server-side lossless segment merge ──────────────────
    //
    // When a multi-segment recording transitions to "completed" the merge
    // worker runs `ffmpeg -f concat -c copy` against all segment files and
    // writes a single merged MP4. The resulting URL is stored here and
    // served preferentially by GET /api/recordings/:id/video — client
    // downloads a single file instead of stitching segments client-side.
    //
    // mergeStatus transitions:
    //   "pending"   → recording completed, merge not started yet
    //   "merging"   → worker is running ffmpeg
    //   "ready"     → mergedVideoUrl is valid and playable
    //   "skipped"   → single-segment recording, merge unnecessary
    //   "failed"    → ffmpeg returned non-zero; mergeError has details
    mergedVideoUrl: { type: String, default: "" },
    mergedFileSize: { type: Number, default: 0 },
    mergeStatus: {
      type: String,
      enum: ["pending", "merging", "ready", "skipped", "failed"],
      default: "pending",
    },
    mergeError: { type: String, default: "" },
    mergedAt: { type: Date },

    // v3.1.24 — whole-recording audio file (decoupled from segment rotation).
    //
    // See I-025: MediaMuxer on 55TR3DK silently drops AAC writeSampleData
    // calls when rotated across segments. Android records audio to a
    // separate dedicated MediaMuxer producing a single m4a file covering
    // the entire recording lifetime, uploads it here, and the segmentMerger
    // does a second ffmpeg pass to mux this audio into the concatenated
    // video. If the audio upload fails, the merge proceeds video-only
    // (graceful degradation).
    audioUrl: { type: String, default: "" },
    audioSize: { type: Number, default: 0 },

    // ── v3.2.0 — LiveKit Egress pipeline (see LIVEKIT_MIGRATION_PLAN.md) ──
    //
    // When the device opts in to the LiveKit pipeline (PreferencesManager.
    // useLiveKitPipeline = true and LIVEKIT_ENABLED=true on backend), the
    // recording flow is:
    //
    //   1. Device POSTs /recordings/session as today.
    //   2. Backend creates a LiveKit room ("phyclass-<recordingId>"),
    //      generates a 4-hour publisher token for the device, and starts
    //      a RoomCompositeEgress writing directly to Azure Blob.
    //   3. Device connects via LiveKit Android SDK and publishes 3 tracks
    //      (screen, camera, mic) — no MediaCodec, no GL compositor, no
    //      segment muxer.
    //   4. When recording stops, backend calls EgressClient.stopEgress.
    //   5. LiveKit fires `egress_ended` webhook → backend marks
    //      mergedVideoUrl + mergeStatus="ready". No ffmpeg, no smoothing.
    //
    // The `segments[]` and `audioUrl` paths above remain populated only
    // for legacy-pipeline recordings; LiveKit recordings populate the
    // fields below instead.
    livekitRoomName: { type: String, default: "" },
    livekitEgressId: { type: String, default: "", index: true },
    livekitEgressStatus: {
      type: String,
      enum: ["pending", "recording", "processing", "available", "failed", ""],
      default: "",
    },
    livekitEgressStartedAt: { type: Date },
    livekitEgressEndedAt: { type: Date },
    livekitEgressErrorReason: { type: String, default: "" },
    // Pipeline marker.
    //
    // v3.3.33: default flipped to "livekit" — every TV in the field
    // since v3.3.26 ships LiveKit-only and the device hardcodes
    // `pipeline: "livekit"` in its session-start request, so any new
    // Recording document that omits this field is implicitly LiveKit.
    // The earlier default of "legacy" caused two real bugs:
    //   1. If a TV's session-start raced the field into the document
    //      before pipeline was set, the doc landed as legacy → backend
    //      skipped LiveKit setup → recording silently failed.
    //   2. Old code paths that constructed Recording docs without
    //      explicitly passing pipeline (e.g. error-recovery flows)
    //      created legacy docs that confused the merge worker.
    //
    // "legacy" stays in the enum for back-compat queries against
    // pre-v3.2 recordings already in the collection.
    pipeline: {
      type: String,
      enum: ["legacy", "livekit"],
      default: "livekit",
      index: true,
    },
  },
  { timestamps: true }
);

// Session lookup and room-based recording queries
recordingSchema.index({ scheduledClass: 1 });
// v2.6.3: speed up heartbeat reconcile + cleanup-stale queries that
// filter on status. Without this, every heartbeat did a full collection
// scan on Recording — fine today, fatal at 10k+ recordings.
recordingSchema.index({ status: 1, recordingStart: 1 });
// Merge retry job scans by mergeStatus to find failed/pending merges.
recordingSchema.index({ mergeStatus: 1 });

module.exports = mongoose.model("LCS_Recording", recordingSchema);
