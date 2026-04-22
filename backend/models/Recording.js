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
  },
  { timestamps: true }
);

// Session lookup and room-based recording queries
recordingSchema.index({ scheduledClass: 1 });

module.exports = mongoose.model("LCS_Recording", recordingSchema);
